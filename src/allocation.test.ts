import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AllocationError, allocateOrder, cancelOrder, confirmAllocationPlan, confirmOrder, createCustomsDeclaration, createOrder, decideApproval, planAllocation, state, sweepExpiredReservations, updateCustoms
} from './domain.js';

const TENANT = 'tenant-acme';
const lot = (lotId: string) => { const value = state.inventory.find(item => item.id === lotId); assert.ok(value, `lot ${lotId} 不存在`); return value; };
const freeOf = (lotId: string) => { const value = lot(lotId); return value.available - value.reserved; };
const activeReservations = (orderId: string) => state.reservations.filter(item => item.orderId === orderId && item.status === 'active');
const confirmableOrder = (reference: string, items: { sku: string; quantity: number; unitPrice?: number; weightKg?: number }[], origin = '上海保税区') => {
  const order = createOrder(TENANT, { customerId: 'CUS-001', reference, origin, destination: '鹿特丹', items: items.map(item => ({ sku: item.sku, description: item.sku, quantity: item.quantity, unitPrice: item.unitPrice ?? 10, weightKg: item.weightKg ?? 1, hsCode: '9025.19' })) });
  confirmOrder(TENANT, order.id, 'tester');
  return order;
};

test('candidate phase only reads lots and explains every selection and skip', () => {
  const before = state.inventory.map(item => ({ id: item.id, reserved: item.reserved, version: item.version }));
  const reservationCount = state.reservations.length;
  const order = confirmableOrder(`PLAN-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity: 2 }]);
  const plan = planAllocation(TENANT, order.id);
  assert.equal(plan.status, 'full');
  assert.equal(plan.lines[0].selections[0].warehouse, 'SHANGHAI-FTZ');
  assert.ok(plan.lines[0].selections[0].reasons.length >= 2, '候选方案必须说明选择原因');
  assert.ok(plan.skippedLots.some(item => item.lotId === 'LOT-005' && /过期/.test(item.reason)), '过期批次必须被跳过并说明原因');
  assert.deepEqual(state.inventory.map(item => ({ id: item.id, reserved: item.reserved, version: item.version })), before, '候选阶段不得修改任何 lot');
  assert.equal(state.reservations.length, reservationCount, '候选阶段不得创建 reservation');
});

test('two concurrent plans competing for the last stock: exactly one confirm wins, loser leaves nothing behind', () => {
  const quantity = freeOf('LOT-004');
  assert.ok(quantity > 0);
  const a = confirmableOrder(`RACE-A-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity }], '洛杉矶');
  const b = confirmableOrder(`RACE-B-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity }], '洛杉矶');
  const planA = planAllocation(TENANT, a.id);
  const planB = planAllocation(TENANT, b.id);
  assert.ok(planA.lines[0].selections.some(item => item.lotId === 'LOT-004'));
  assert.ok(planB.lines[0].selections.some(item => item.lotId === 'LOT-004'));
  const winner = confirmAllocationPlan(TENANT, a.id, planA, 'tester');
  assert.ok(winner.ok);
  const loser = confirmAllocationPlan(TENANT, b.id, planB, 'tester');
  if (loser.ok) assert.fail('并发确认不应成功');
  assert.equal(loser.code, 'ALLOCATION_CONFLICT');
  assert.ok(loser.conflicts?.some(item => item.lotId === 'LOT-004' && item.reason === 'VERSION_MISMATCH'));
  assert.equal(activeReservations(b.id).length, 0, '失败方案不能留下半笔占用');
  assert.equal(state.orders.find(item => item.id === b.id)?.status, 'confirmed');
  const lot004 = lot('LOT-004');
  assert.ok(lot004.reserved <= lot004.available, 'reserved 不能超过 available');
  assert.equal(freeOf('LOT-004'), 0);
  const replay = confirmAllocationPlan(TENANT, a.id, planA, 'tester');
  if (replay.ok) assert.fail('已分配订单不能重复确认');
  assert.equal(replay.code, 'ORDER_STATE_CONFLICT');
  assert.ok(state.audit.some(item => item.action === 'order.allocation.conflicted' && item.entityId === b.id), '冲突决策必须留痕');
});

test('allocateOrder never lets reserved exceed available and fails atomically', () => {
  const compliantFree = ['LOT-001', 'LOT-003', 'LOT-004'].reduce((sum, lotId) => sum + freeOf(lotId), 0);
  const order = confirmableOrder(`OVER-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity: compliantFree + 5, unitPrice: 1 }]);
  const snapshot = state.inventory.map(item => ({ id: item.id, reserved: item.reserved, version: item.version }));
  const reservationCount = state.reservations.length;
  assert.throws(() => allocateOrder(TENANT, order.id, 'tester'), (error: unknown) => {
    assert.ok(error instanceof AllocationError);
    assert.equal(error.code, 'INSUFFICIENT_STOCK');
    assert.match(error.message, /库存不足/);
    return true;
  });
  assert.deepEqual(state.inventory.map(item => ({ id: item.id, reserved: item.reserved, version: item.version })), snapshot, '失败不能改动任何 lot');
  assert.equal(state.reservations.length, reservationCount, '失败不能留下半笔 reservation');
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'confirmed');
});

test('cancel releases every active reservation across all lots by exact quantities', () => {
  const spill = freeOf('LOT-001') + 5;
  const order = confirmableOrder(`CANCEL-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity: spill, unitPrice: 1 }]);
  allocateOrder(TENANT, order.id, 'tester');
  const reservations = activeReservations(order.id);
  assert.ok(reservations.length >= 2, '订单应跨多个批次');
  const before = new Map(reservations.map(item => [item.lotId, lot(item.lotId).reserved]));
  cancelOrder(TENANT, order.id, 'tester');
  for (const reservation of reservations) {
    assert.equal(reservation.status, 'released');
    assert.equal(reservation.releaseReason, 'cancelled');
    assert.equal(lot(reservation.lotId).reserved, before.get(reservation.lotId)! - reservation.quantity);
  }
  assert.equal(activeReservations(order.id).length, 0);
  assert.ok(state.inventory.every(item => item.reserved <= item.available));
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'cancelled');
});

test('customs rejection releases stock and fails the whole order consistently', () => {
  const order = confirmableOrder(`CUSTOMS-${Date.now()}`, [{ sku: 'SENSOR-X9', quantity: 3 }, { sku: 'CONTROL-M2', quantity: 2 }]);
  allocateOrder(TENANT, order.id, 'tester');
  const reservations = activeReservations(order.id);
  assert.ok(reservations.length >= 2);
  const before = new Map(reservations.map(item => [item.lotId, lot(item.lotId).reserved]));
  const declaration = createCustomsDeclaration(TENANT, { orderId: order.id });
  updateCustoms(TENANT, declaration.id, { status: 'rejected', rejectionReason: '原产地证缺失' }, 'customs-officer');
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'cancelled');
  for (const reservation of reservations) {
    assert.equal(reservation.status, 'released');
    assert.equal(reservation.releaseReason, 'customs_rejected');
    assert.equal(lot(reservation.lotId).reserved, before.get(reservation.lotId)! - reservation.quantity);
  }
  const auditEvent = state.audit.find(item => item.action === 'order.cancelled' && item.entityId === order.id);
  const outboxEvent = state.outbox.find(item => item.topic === 'order.cancelled' && item.aggregateId === order.id);
  assert.ok(auditEvent && outboxEvent, 'audit 与 outbox 必须同时记录同一笔取消决策');
  assert.equal((outboxEvent.payload as { order: { id: string } }).order.id, order.id);
});

test('credit approval rejection cancels the order explicitly', () => {
  const order = createOrder(TENANT, { customerId: 'CUS-002', reference: `CREDIT-REJ-${Date.now()}`, origin: '深圳', destination: '洛杉矶', items: [{ sku: 'CONTROL-M2', description: '控制模块', quantity: 10, unitPrice: 420, weightKg: 2, hsCode: '8537.10' }] });
  assert.throws(() => confirmOrder(TENANT, order.id, 'tester'), /需要审批/);
  const approval = state.approvals.find(item => item.orderId === order.id && item.type === 'credit_override');
  assert.ok(approval);
  decideApproval(TENANT, approval.id, { status: 'rejected', comment: '客户信用状况不达标' }, 'finance');
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'cancelled');
  assert.ok(state.outbox.some(item => item.topic === 'order.cancelled' && item.aggregateId === order.id));
});

test('expired reservations are released, order goes backordered and can be re-allocated', () => {
  const order = confirmableOrder(`EXPIRE-${Date.now()}`, [{ sku: 'CONTROL-M2', quantity: 4 }]);
  allocateOrder(TENANT, order.id, 'tester');
  const reservation = activeReservations(order.id)[0];
  assert.ok(reservation.expiresAt, '预留必须带过期时间');
  const lotId = reservation.lotId;
  const reservedBefore = lot(lotId).reserved;
  const result = sweepExpiredReservations(TENANT, new Date(Date.now() + 73 * 3600 * 1000).toISOString(), 'tester');
  assert.ok(result.releasedCount >= 1);
  assert.equal(reservation.status, 'released');
  assert.equal(reservation.releaseReason, 'expired');
  assert.equal(lot(lotId).reserved, reservedBefore - reservation.quantity);
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'backordered');
  assert.ok(state.outbox.some(item => item.topic === 'inventory.reservation.expired' && item.aggregateId === order.id));
  allocateOrder(TENANT, order.id, 'tester');
  assert.equal(state.orders.find(item => item.id === order.id)?.status, 'allocated');
  assert.equal(activeReservations(order.id).reduce((sum, item) => sum + item.quantity, 0), 4);
});

test('partial availability: backorder policy reserves real quantities, default policy fails cleanly', () => {
  const free = freeOf('LOT-002');
  const backordered = confirmableOrder(`PARTIAL-${Date.now()}`, [{ sku: 'CONTROL-M2', quantity: free + 6, unitPrice: 1 }]);
  const order = allocateOrder(TENANT, backordered.id, 'tester', { onPartial: 'backorder' });
  assert.equal(order.status, 'backordered');
  assert.equal(activeReservations(order.id).reduce((sum, item) => sum + item.quantity, 0), free);
  const auditEvent = state.audit.find(item => item.action === 'order.backordered' && item.entityId === order.id);
  assert.ok(auditEvent);
  assert.deepEqual((auditEvent.after as { shortfalls: { sku: string; missing: number }[] }).shortfalls.map(item => ({ sku: item.sku, missing: item.missing })), [{ sku: 'CONTROL-M2', missing: 6 }]);
  const failing = confirmableOrder(`PARTIAL-FAIL-${Date.now()}`, [{ sku: 'CONTROL-M2', quantity: 6, unitPrice: 1 }]);
  assert.throws(() => allocateOrder(TENANT, failing.id, 'tester'), /库存不足/);
  assert.equal(activeReservations(failing.id).length, 0);
  assert.equal(state.orders.find(item => item.id === failing.id)?.status, 'confirmed');
});
