import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AllocationError, allocateOrder, cancelOrder, confirmOrder, confirmOrderAllocation,
  createCustomsDeclaration, createOrder, decideApproval, expireReservations, planOrderAllocation,
  receiveStock, state, topUpOrderAllocation, updateCustoms, type InventoryLot
} from './domain.js';

const TENANT = 'tenant-acme';

function makeSku() { return `SKU-RACE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; }

/** 建一个独立 SKU 的隔离库存，避免与其它测试/种子数据互相干扰。 */
function seedIsolatedLot(opts: { sku: string; warehouse: string; available: number; expiresAt?: string; lotCode?: string }): InventoryLot {
  const lot: InventoryLot = {
    id: `LOT-T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    tenantId: TENANT, warehouse: opts.warehouse, sku: opts.sku,
    available: opts.available, reserved: 0, version: 1,
    lotCode: opts.lotCode ?? `${opts.sku}-LOT`, expiresAt: opts.expiresAt
  };
  state.inventory.push(lot);
  return lot;
}

function confirmedOrder(reference: string, opts: { sku: string; quantity: number; unitPrice?: number; origin?: string; destination?: string; priority?: 'standard' | 'urgent' | 'critical'; customerId?: string }) {
  const order = createOrder(TENANT, {
    customerId: opts.customerId ?? 'CUS-001', reference,
    origin: opts.origin ?? '上海保税区', destination: opts.destination ?? '鹿特丹',
    priority: opts.priority ?? 'standard',
    items: [{ description: opts.sku, sku: opts.sku, quantity: opts.quantity, unitPrice: opts.unitPrice ?? 10, weightKg: 1, hsCode: '0000.00' }]
  });
  confirmOrder(TENANT, order.id, 'tester');
  return order;
}

function activeReservations(orderId: string) {
  return state.reservations.filter(item => item.orderId === orderId && item.status === 'active');
}

test('两个候选并发争抢最后一批库存：只有一个确认成功，失败方可识别且零半成品', () => {
  const sku = makeSku();
  const lot = seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 10 });

  const orderA = confirmedOrder(`RACE-A-${Date.now()}`, { sku, quantity: 10 });
  const orderB = confirmedOrder(`RACE-B-${Date.now()}`, { sku, quantity: 10 });

  // 阶段一：两个方案都只读取库存，此时都看到 10 件余量，均可行。
  const planA = planOrderAllocation(TENANT, orderA.id, { mode: 'full', actor: 'tester' });
  const planB = planOrderAllocation(TENANT, orderB.id, { mode: 'full', actor: 'tester' });
  assert.equal(planA.feasible, true);
  assert.equal(planB.feasible, true);
  assert.equal(planA.lines[0].candidates[0].lotVersion, 1);
  assert.equal(planB.lines[0].candidates[0].lotVersion, 1);
  // 候选阶段绝不动库存。
  assert.equal(lot.reserved, 0);
  assert.equal(lot.version, 1);

  // 阶段二：A 先确认，lot 版本从 v1 推进到 v2。
  const resultA = confirmOrderAllocation(TENANT, planA.id, { actor: 'tester' });
  assert.equal(resultA.order.status, 'allocated');
  assert.equal(lot.reserved, 10);
  assert.equal(lot.version, 2);

  // B 基于过期的 v1 快照确认：原子版本校验失败。
  const error = expectAllocationError(() => confirmOrderAllocation(TENANT, planB.id, { actor: 'tester' }));
  assert.equal(error.code, 'LOT_VERSION_CONFLICT');
  assert.ok(error.conflicts?.some(c => c.lotId === lot.id && c.expectedVersion === 1 && c.actualVersion === 2));

  // 失败方不留下任何半成品：无 reservation、库存未被 B 触碰、方案标记 conflicted。
  assert.deepEqual(activeReservations(orderB.id), []);
  assert.equal(lot.reserved, 10);
  assert.equal(lot.version, 2);
  const storedPlanB = state.allocationPlans.find(p => p.id === planB.id)!;
  assert.equal(storedPlanB.status, 'conflicted');
  assert.equal(storedPlanB.conflictCode, 'LOT_VERSION_CONFLICT');

  // 订单/lot 始终满足 reserved <= available。
  for (const each of state.inventory) assert.ok(each.reserved <= each.available, `${each.id} reserved ${each.reserved} > available ${each.available}`);

  // audit 与 outbox 同时记录了 B 的竞争失败决策。
  assert.ok(state.audit.some(a => a.entityId === planB.id && a.action === 'allocation.rejected'));
  assert.ok(state.outbox.some(o => o.topic === 'allocation.rejected' && JSON.stringify(o.payload).includes(planB.id)));
});

test('同一订单两个候选方案：先确认的胜出，另一个变为 superseded 且无法再确认', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'ROTTERDAM-DC', available: 5 });
  const order = confirmedOrder(`RACE-C-${Date.now()}`, { sku, quantity: 3 });

  const p1 = planOrderAllocation(TENANT, order.id, { actor: 'tester' });
  const p2 = planOrderAllocation(TENANT, order.id, { actor: 'tester' });
  confirmOrderAllocation(TENANT, p1.id, { actor: 'tester' });

  const error = expectAllocationError(() => confirmOrderAllocation(TENANT, p2.id, { actor: 'tester' }));
  assert.equal(error.code, 'PLAN_SUPERSEDED');
  assert.ok(error.message.includes('superseded') || error.message.includes('失效'));
  assert.equal(state.allocationPlans.find(p => p.id === p2.id)!.status, 'superseded');
  // 只建立一套 reservation，没有重复占用。
  assert.equal(activeReservations(order.id).reduce((s, r) => s + r.quantity, 0), 3);
});

test('候选阶段解释选择原因：起点同仓优先、FEFO 近效期优先、承运通道与排除原因', () => {
  const sku = makeSku();
  // 上海 100 件效期晚；鹿特丹 5 件效期更早；洛杉矶 8 件。
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 100, lotCode: `${sku}-SH`, expiresAt: '2027-12-31T00:00:00.000Z' });
  seedIsolatedLot({ sku, warehouse: 'ROTTERDAM-DC', available: 5, lotCode: `${sku}-RTM`, expiresAt: '2026-12-01T00:00:00.000Z' });
  seedIsolatedLot({ sku, warehouse: 'LOS-ANGELES', available: 8, lotCode: `${sku}-LAX`, expiresAt: '2027-06-01T00:00:00.000Z' });

  // urgent 且起点上海：应先取上海仓，即便其效期更晚。
  const urgent = confirmedOrder(`PLAN-U-${Date.now()}`, { sku, quantity: 20, priority: 'urgent' });
  const urgentPlan = planOrderAllocation(TENANT, urgent.id, { actor: 'tester' });
  assert.equal(urgentPlan.lines[0].candidates[0].warehouse, 'SHANGHAI-FTZ');
  assert.ok(urgentPlan.lines[0].candidates[0].reasons.some(r => r.includes('同址')));
  assert.ok(urgentPlan.lines[0].candidates[0].reasons.some(r => r.includes('FEFO')));
  assert.ok(urgentPlan.lines[0].candidates[0].reasons.some(r => r.includes('承运通道')));

  // standard：FEFO 应先取效期最早的鹿特丹 5 件，再取洛杉矶 8 件……
  const standard = confirmedOrder(`PLAN-S-${Date.now()}`, { sku, quantity: 20, priority: 'standard' });
  const standardPlan = planOrderAllocation(TENANT, standard.id, { actor: 'tester' });
  assert.equal(standardPlan.lines[0].candidates[0].warehouse, 'ROTTERDAM-DC');
  assert.equal(standardPlan.lines[0].candidates[0].quantity, 5);
  assert.equal(standardPlan.lines[0].candidates[1].warehouse, 'LOS-ANGELES');
  // 候选阶段不写库存。
  assert.equal(activeReservations(urgent.id).length, 0);
  assert.equal(activeReservations(standard.id).length, 0);
});

test('整单模式库存不足：抛 INSUFFICIENT_STOCK，整单失败且不建任何预留', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 6 });
  const order = confirmedOrder(`SHORT-${Date.now()}`, { sku, quantity: 10 });

  const plan = planOrderAllocation(TENANT, order.id, { mode: 'full', actor: 'tester' });
  assert.equal(plan.feasible, false);
  assert.equal(plan.shortages[0].short, 4);

  const error = expectAllocationError(() => confirmOrderAllocation(TENANT, plan.id, { mode: 'full', actor: 'tester' }));
  assert.equal(error.code, 'INSUFFICIENT_STOCK');
  assert.ok(error.message.includes('缺口 4'));
  assert.deepEqual(activeReservations(order.id), []);
  assert.equal(state.orders.find(o => o.id === order.id)!.status, 'confirmed');
  assert.equal(state.allocationPlans.find(p => p.id === plan.id)!.status, 'conflicted');
});

test('部分可分配：进入待补货，按真实数量占用；入库补齐后 top-up 回到 allocated', async () => {
  const sku = makeSku();
  const lot = seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 6 });

  const order = confirmedOrder(`PARTIAL-${Date.now()}`, { sku, quantity: 10 });
  const plan = planOrderAllocation(TENANT, order.id, { mode: 'partial', actor: 'tester' });
  const result = confirmOrderAllocation(TENANT, plan.id, { mode: 'partial', actor: 'tester' });

  assert.equal(result.order.status, 'backordered');
  assert.equal(result.order.allocation?.lines[0].allocated, 6);
  assert.deepEqual(result.order.allocation?.shortages[0], { sku, required: 10, satisfiable: 6, short: 4 });
  const reservation = activeReservations(order.id);
  assert.equal(reservation.length, 1);
  assert.equal(reservation[0].quantity, 6);
  assert.equal(lot.reserved, 6);
  assert.equal(lot.version, 2);
  assert.ok(reservation[0].expiresAt);

  // 待补货期间即使报关放行也不能出运。
  const declaration = createCustomsDeclaration(TENANT, { orderId: order.id });
  updateCustoms(TENANT, declaration.id, { documentRefs: declaration.requiredDocuments, status: 'submitted' }, 'tester');
  updateCustoms(TENANT, declaration.id, { status: 'cleared' }, 'tester');
  const { dispatchOrder } = await import('./domain.js');
  assert.throws(() => dispatchOrder(TENANT, order.id, 'tester'), /不能出运/);

  // 入库 4 件补齐缺口，top-up 后回到 allocated，两笔预留合起来恰好 10。
  receiveStock(TENANT, { warehouse: 'SHANGHAI-FTZ', sku, quantity: 4, lotCode: lot.lotCode }, 'tester');
  const topped = topUpOrderAllocation(TENANT, order.id, { actor: 'tester' });
  assert.equal(topped.status, 'allocated');
  assert.equal(activeReservations(order.id).reduce((s, r) => s + r.quantity, 0), 10);
  assert.deepEqual(topped.allocation?.shortages[0], { sku, required: 10, satisfiable: 10, short: 0 });
});

test('取消订单：多仓多 lot 预留全部按真实数量释放，承运能力与信用同步归还', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 3, lotCode: `${sku}-SH` });
  seedIsolatedLot({ sku, warehouse: 'ROTTERDAM-DC', available: 4, lotCode: `${sku}-RTM` });

  const order = confirmedOrder(`CANCEL-${Date.now()}`, { sku, quantity: 7, unitPrice: 100 });
  allocateOrder(TENANT, order.id, 'tester');

  const lots = state.inventory.filter(l => l.sku === sku);
  const reservedBefore = lots.reduce((s, l) => s + l.reserved, 0);
  assert.equal(reservedBefore, 7);
  const lanes = state.carrierLanes.filter(l => l.capacity - l.used < l.capacity && l.used > 0);
  assert.ok(lanes.some(l => l.used > 0));
  const customerBefore = state.customers.find(c => c.id === 'CUS-001')!.creditUsed;

  cancelOrder(TENANT, order.id, 'tester');

  assert.equal(state.orders.find(o => o.id === order.id)!.status, 'cancelled');
  for (const lot of lots) assert.equal(lot.reserved, 0, `${lot.id} 预留必须清零`);
  for (const reservation of state.reservations.filter(r => r.orderId === order.id)) {
    assert.equal(reservation.status, 'released');
    assert.equal(reservation.releasedReason, 'order_cancelled');
  }
  const customerAfter = state.customers.find(c => c.id === 'CUS-001')!.creditUsed;
  assert.equal(moneyRound(customerAfter), moneyRound(customerBefore - 700));
  assert.ok(state.outbox.some(o => o.topic === 'order.cancelled' && JSON.stringify(o.payload).includes(order.id)));
});

test('预留过期：按真实数量释放，订单进入待补货并保留缺口，补齐后恢复 allocated', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 8 });
  const order = confirmedOrder(`EXPIRE-${Date.now()}`, { sku, quantity: 8, unitPrice: 10 });
  const laneBefore = state.carrierLanes.map(l => ({ id: l.id, used: l.used }));
  const result = confirmOrderAllocation(TENANT, planOrderAllocation(TENANT, order.id, { ttlMs: 1000, actor: 'tester' }).id, { actor: 'tester' });
  assert.equal(result.order.status, 'allocated');
  const reservationId = result.reservations[0].id;
  const reservedUntil = result.order.allocation!.reservedUntil;

  const outcome = expireReservations(TENANT, { asOf: reservedUntil, actor: 'tester' });
  assert.ok(outcome.released.some(r => r.id === reservationId));
  assert.ok(outcome.affectedOrders.includes(order.id));

  const storedOrder = state.orders.find(o => o.id === order.id)!;
  assert.equal(storedOrder.status, 'backordered');
  assert.equal(storedOrder.allocation?.shortages[0].short, 8);
  assert.deepEqual(activeReservations(order.id), []);
  const lot = state.inventory.find(l => l.sku === sku)!;
  assert.equal(lot.reserved, 0);
  // 通道能力按真实数量归还（与其它测试共用通道，故比对分配前基线）。
  const lane = state.carrierLanes.find(l => l.id === result.reservations[0].laneId)!;
  assert.equal(lane.used, laneBefore.find(l => l.id === lane.id)!.used);
  assert.equal(state.reservations.find(r => r.id === reservationId)!.releasedReason, 'reservation_expired');

  // 再次入库补齐并补货，订单恢复。
  receiveStock(TENANT, { warehouse: 'SHANGHAI-FTZ', sku, quantity: 8, lotCode: lot.lotCode }, 'tester');
  const topped = topUpOrderAllocation(TENANT, order.id, { ttlMs: 60_000, actor: 'tester' });
  assert.equal(topped.status, 'allocated');
});

test('报关拒收：整单失败——订单取消、全部预留与信用释放、决策可审计', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 4 });
  const order = confirmedOrder(`CUSTOMS-${Date.now()}`, { sku, quantity: 4, unitPrice: 50 });
  allocateOrder(TENANT, order.id, 'tester');
  const customerBefore = state.customers.find(c => c.id === 'CUS-001')!.creditUsed;

  const declaration = createCustomsDeclaration(TENANT, { orderId: order.id });
  updateCustoms(TENANT, declaration.id, { documentRefs: declaration.requiredDocuments, status: 'submitted' }, 'tester');
  updateCustoms(TENANT, declaration.id, { status: 'rejected', rejectionReason: '原产地证疑似不符' }, 'tester');

  const stored = state.orders.find(o => o.id === order.id)!;
  assert.equal(stored.status, 'cancelled');
  assert.ok(stored.failureReason?.includes('customs_rejected'));
  assert.deepEqual(activeReservations(order.id), []);
  for (const r of state.reservations.filter(r => r.orderId === order.id)) {
    assert.equal(r.status, 'released');
    assert.equal(r.releasedReason, 'customs_rejected');
  }
  const customerAfter = state.customers.find(c => c.id === 'CUS-001')!.creditUsed;
  assert.equal(moneyRound(customerAfter), moneyRound(customerBefore - 200));
  assert.ok(state.outbox.some(o => o.topic === 'order.cancelled' && JSON.stringify(o.payload).includes('customs_rejected')));
});

test('信用审批被拒绝：draft 订单整单失败取消，且未来再确认直接被状态机拒绝', () => {
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 100 });
  const order = createOrder(TENANT, {
    customerId: 'CUS-002', reference: `CREDIT-RJ-${Date.now()}`, origin: '上海保税区', destination: '洛杉矶',
    items: [{ description: sku, sku, quantity: 10, unitPrice: 1000, weightKg: 1, hsCode: '0000.00' }]
  });
  assert.throws(() => confirmOrder(TENANT, order.id, 'tester'), /需要审批/);
  const approval = state.approvals.find(a => a.orderId === order.id && a.type === 'credit_override')!;
  decideApproval(TENANT, approval.id, { status: 'rejected', comment: '风控拒绝提额' }, 'finance');

  const stored = state.orders.find(o => o.id === order.id)!;
  assert.equal(stored.status, 'cancelled');
  assert.ok(stored.failureReason?.includes('credit_approval_rejected'));
  assert.throws(() => confirmOrder(TENANT, order.id, 'finance'), /不能从 cancelled/);
});

test('承运能力不足会在候选阶段被排除并说明原因，确认阶段被并发挤占时整体失败无半成品', () => {
  const sku = makeSku();
  const lot = seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 100 });
  const lane = state.carrierLanes.find(l => l.warehouse === 'SHANGHAI-FTZ' && l.destination === '鹿特丹')!;
  const cap = lane.capacity;
  lane.capacity = 5; lane.used = 0; // 人为压缩通道能力到 5

  const order = confirmedOrder(`LANE-${Date.now()}`, { sku, quantity: 10 });
  const plan = planOrderAllocation(TENANT, order.id, { mode: 'full', actor: 'tester' });
  // 候选只拿到 5（库存 100 但通道只剩 5），整单不可行。
  assert.equal(plan.lines[0].candidates[0].quantity, 5);
  assert.equal(plan.shortages[0].short, 5);
  assert.ok(plan.excludedLots.some(e => e.reason.includes('承运通道') && e.sku === sku) || plan.lines[0].candidates[0].reasons.some(r => r.includes('剩余能力 5')));

  // 另一个订单先把 5 件通道能力抢走，原方案确认时通道与 lot 版本校验同时失败。
  const rival = confirmedOrder(`LANE-R-${Date.now()}`, { sku, quantity: 5 });
  const rivalPlan = planOrderAllocation(TENANT, rival.id, { mode: 'full', actor: 'tester' });
  confirmOrderAllocation(TENANT, rivalPlan.id, { actor: 'tester' });

  const error = expectAllocationError(() => confirmOrderAllocation(TENANT, plan.id, { mode: 'full', actor: 'tester' }));
  assert.ok(['LOT_VERSION_CONFLICT', 'INSUFFICIENT_CARRIER_CAPACITY', 'INSUFFICIENT_STOCK'].includes(error.code));
  assert.deepEqual(activeReservations(order.id), []);
  assert.equal(lot.reserved, 5); // 只有 rival 占用
  lane.capacity = cap; // 恢复避免影响其它测试
});

test('时间线、audit、outbox 围绕同一笔分配决策保持一致', async () => {
  const { timeline: getTimeline } = await import('./domain.js');
  const sku = makeSku();
  seedIsolatedLot({ sku, warehouse: 'SHANGHAI-FTZ', available: 3 });
  const order = confirmedOrder(`TL-${Date.now()}`, { sku, quantity: 3 });
  const plan = planOrderAllocation(TENANT, order.id, { actor: 'tester' });
  confirmOrderAllocation(TENANT, plan.id, { actor: 'tester' });

  const events = getTimeline(TENANT, order.id);
  const actions = events.map(e => e.action);
  assert.ok(actions.includes('allocation.planned'));
  assert.ok(actions.includes('order.allocated'));

  // reservation 的释放事件也带 orderId，可在时间线中看到。
  cancelOrder(TENANT, order.id, 'tester');
  const eventsAfter = getTimeline(TENANT, order.id);
  assert.ok(eventsAfter.some(e => e.action === 'inventory.released'));
  assert.ok(state.outbox.filter(o => JSON.stringify(o.payload).includes(order.id)).length >= 3);
});

function expectAllocationError(fn: () => unknown): AllocationError {
  try { fn(); } catch (err) { if (err instanceof AllocationError) return err; throw err; }
  throw new assert.AssertionError({ message: 'expected AllocationError to be thrown' });
}

function moneyRound(value: number) { return Math.round(value * 100) / 100; }
