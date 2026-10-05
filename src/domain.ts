import { randomUUID } from 'node:crypto';

export type OrderStatus = 'draft' | 'confirmed' | 'allocated' | 'backordered' | 'dispatched' | 'delivered' | 'closed' | 'cancelled';
export type CustomsStatus = 'draft' | 'submitted' | 'inspection' | 'cleared' | 'rejected';
export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

type Tenant = { id: string; name: string; creditLimit: number; creditUsed: number; currency: string };
type Customer = { id: string; tenantId: string; name: string; creditLimit: number; creditUsed: number; blocked: boolean; timezone?: string };
type OrderItem = { sku: string; description: string; quantity: number; unitPrice: number; weightKg: number; hsCode: string };
export type Order = { id: string; tenantId: string; customerId: string; reference: string; origin: string; destination: string; priority: 'standard' | 'urgent' | 'critical'; status: OrderStatus; items: OrderItem[]; totalWeightKg: number; subtotal: number; totalAmount: number; currency: string; version: number; shipmentId?: string; customsDeclarationId?: string; invoiceId?: string; createdAt: string; updatedAt: string };
type InventoryLot = { id: string; tenantId: string; warehouse: string; sku: string; available: number; reserved: number; lotCode: string; expiresAt?: string; version: number };
type Reservation = { id: string; tenantId: string; orderId: string; lotId: string; sku: string; quantity: number; status: 'active' | 'released' | 'consumed'; expiresAt?: string; releaseReason?: string; createdAt: string };
type ShipmentLeg = { id: string; mode: 'truck' | 'rail' | 'sea' | 'air'; origin: string; destination: string; plannedDeparture: string; plannedArrival: string; actualArrival?: string; status: 'planned' | 'in_transit' | 'arrived' | 'delayed' };
type Shipment = { id: string; tenantId: string; orderId: string; trackingNo: string; legs: ShipmentLeg[]; currentLocation: string; eta: string; status: 'planned' | 'in_transit' | 'delivered' | 'exception'; events: { id: string; code: string; location: string; occurredAt: string; note?: string }[] };
type CustomsDeclaration = { id: string; tenantId: string; orderId: string; country: string; status: CustomsStatus; documentRefs: string[]; requiredDocuments: string[]; riskScore: number; rejectionReason?: string; updatedAt: string };
type InvoiceLine = { code: string; description: string; quantity: number; unitPrice: number; amount: number };
type Invoice = { id: string; tenantId: string; orderId: string; number: string; status: InvoiceStatus; currency: string; lines: InvoiceLine[]; subtotal: number; tax: number; total: number; paid: number; dueDate: string; createdAt: string };
type Payment = { id: string; tenantId: string; invoiceId: string; amount: number; method: 'bank_transfer' | 'card' | 'credit_note'; reference: string; receivedAt: string };
type Approval = { id: string; tenantId: string; orderId: string; type: 'credit_override' | 'customs_exception' | 'delay_compensation'; reason: string; status: ApprovalStatus; decidedBy?: string; comment?: string; createdAt: string; decidedAt?: string };
export type AuditEvent = { id: string; tenantId: string; actor: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; at: string };
export type OutboxEvent = { id: string; tenantId: string; topic: string; aggregateId: string; payload: unknown; status: 'pending' | 'published'; attempts: number; createdAt: string };

type State = { tenants: Tenant[]; customers: Customer[]; orders: Order[]; inventory: InventoryLot[]; reservations: Reservation[]; shipments: Shipment[]; customs: CustomsDeclaration[]; invoices: Invoice[]; payments: Payment[]; approvals: Approval[]; audit: AuditEvent[]; outbox: OutboxEvent[] };
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const money = (value: number) => Math.round(value * 100) / 100;

export const state: State = {
  tenants: [{ id: 'tenant-acme', name: 'Acme Global Trading', creditLimit: 250000, creditUsed: 36200, currency: 'USD' }],
  customers: [{ id: 'CUS-001', tenantId: 'tenant-acme', name: 'Northstar Retail GmbH', creditLimit: 100000, creditUsed: 12000, blocked: false, timezone: 'Europe/Berlin' }, { id: 'CUS-002', tenantId: 'tenant-acme', name: 'Pacific Parts Inc.', creditLimit: 50000, creditUsed: 49000, blocked: false, timezone: 'America/Los_Angeles' }],
  orders: [], inventory: [
    { id: 'LOT-001', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'SENSOR-X9', available: 80, reserved: 10, lotCode: 'SX9-2608', expiresAt: '2027-06-30T00:00:00.000Z', version: 1 },
    { id: 'LOT-002', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'CONTROL-M2', available: 36, reserved: 4, lotCode: 'CM2-2607', version: 1 },
    { id: 'LOT-003', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', sku: 'SENSOR-X9', available: 12, reserved: 0, lotCode: 'SX9-2606', expiresAt: '2026-11-15T00:00:00.000Z', version: 1 },
    { id: 'LOT-004', tenantId: 'tenant-acme', warehouse: 'LOS-ANGELES-DC', sku: 'SENSOR-X9', available: 50, reserved: 0, lotCode: 'SX9-2609', version: 1 },
    { id: 'LOT-005', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'SENSOR-X9', available: 40, reserved: 0, lotCode: 'SX9-2501', expiresAt: '2026-01-01T00:00:00.000Z', version: 1 }
  ], reservations: [], shipments: [], customs: [], invoices: [], payments: [], approvals: [], audit: [], outbox: []
};

function tenant(id: string) { const value = state.tenants.find(item => item.id === id); if (!value) throw new Error('租户不存在'); return value; }
function assertTenant<T extends { tenantId: string }>(item: T, tenantId: string) { if (item.tenantId !== tenantId) throw new Error('无权访问其他租户的数据'); return item; }
function customerFor(tenantId: string, customerId: string) { const customer = state.customers.find(item => item.id === customerId && item.tenantId === tenantId); if (!customer) throw new Error('客户不存在'); return customer; }
function orderFor(tenantId: string, orderId: string) { const order = state.orders.find(item => item.id === orderId); if (!order) throw new Error('订单不存在'); return assertTenant(order, tenantId); }
function record(tenantId: string, actor: string, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) { state.audit.unshift({ id: id('AUD'), tenantId, actor, action, entityType, entityId, before: before === undefined ? undefined : clone(before), after: after === undefined ? undefined : clone(after), at: now() }); }
function emit(tenantId: string, topic: string, aggregateId: string, payload: unknown) { state.outbox.unshift({ id: id('EVT'), tenantId, topic, aggregateId, payload: clone(payload), status: 'pending', attempts: 0, createdAt: now() }); }
function mutate(tenantId: string, actor: string, action: string, type: string, entityId: string, before: unknown, after: unknown, topic: string) { record(tenantId, actor, action, type, entityId, before, after); if (action !== 'order.confirmed') emit(tenantId, topic, entityId, after); }
function transition(order: Order, next: OrderStatus) { const allowed: Record<OrderStatus, OrderStatus[]> = { draft: ['confirmed', 'cancelled'], confirmed: ['allocated', 'backordered', 'cancelled'], allocated: ['dispatched', 'backordered', 'cancelled'], backordered: ['allocated', 'cancelled'], dispatched: ['delivered'], delivered: ['closed', 'dispatched'], closed: [], cancelled: [] }; if (!allowed[order.status].includes(next)) throw new Error(`订单不能从 ${order.status} 变更为 ${next}`); order.status = next; order.version += 1; order.updatedAt = now(); }

export function listOrders(tenantId: string, filters: { status?: string; customerId?: string; q?: string } = {}) { tenant(tenantId); return state.orders.filter(item => item.tenantId === tenantId && (!filters.status || item.status === filters.status) && (!filters.customerId || item.customerId === filters.customerId) && (!filters.q || `${item.reference} ${item.destination}`.toLowerCase().includes(filters.q.toLowerCase()))).map(clone); }
export function getOrder(tenantId: string, orderId: string) { return clone(orderFor(tenantId, orderId)); }
export function createOrder(tenantId: string, input: Partial<Order>, actor = 'system') {
  tenant(tenantId); if (!input.customerId || !input.reference || !input.origin || !input.destination || !input.items?.length) throw new Error('客户、参考号、起讫地和订单明细均不能为空');
  if (state.orders.some(item => item.reference === input.reference)) throw new Error('客户参考号已存在');
  const items = input.items.map(item => { if (!item.sku || !item.quantity || item.quantity <= 0 || !item.unitPrice || item.unitPrice < 0 || !item.weightKg || item.weightKg <= 0) throw new Error('订单明细数量、价格和重量必须为正数'); return { sku: item.sku, description: item.description ?? item.sku, quantity: item.quantity, unitPrice: item.unitPrice, weightKg: item.weightKg, hsCode: item.hsCode ?? '0000.00' }; });
  const subtotal = money(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)); const order: Order = { id: id('ORD'), tenantId, customerId: input.customerId, reference: input.reference, origin: input.origin, destination: input.destination, priority: input.priority ?? 'standard', status: 'draft', items, totalWeightKg: money(items.reduce((sum, item) => sum + item.quantity * item.weightKg, 0)), subtotal, totalAmount: subtotal, currency: input.currency ?? tenant(tenantId).currency, version: 1, createdAt: now(), updatedAt: now() };
  state.orders.unshift(order); mutate(tenantId, actor, 'order.created', 'order', order.id, undefined, order, 'order.created'); return clone(order);
}
export function confirmOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const before = clone(order); const customer = customerFor(tenantId, order.customerId); if (customer.blocked) throw new Error('客户已被风控冻结'); if (customer.creditUsed + order.totalAmount > customer.creditLimit) { const approval = createApproval(tenantId, { orderId, type: 'credit_override', reason: '订单金额超过客户授信额度' }, actor); throw new Error(`客户授信不足，需要审批 ${approval.id}`); } transition(order, 'confirmed'); customer.creditUsed = money(customer.creditUsed + order.totalAmount); mutate(tenantId, actor, 'order.confirmed', 'order', order.id, before, order, 'order.confirmed'); return clone(order); }
// ---------- 库存分配：候选规划（只读）+ 确认执行（原子校验）两阶段 ----------
export type AllocationSelection = { lotId: string; warehouse: string; lotCode: string; sku: string; quantity: number; lotVersion: number; freeAtPlan: number; expiresAt?: string; reasons: string[] };
export type AllocationPlanLine = { sku: string; requested: number; alreadyReserved: number; allocated: number; selections: AllocationSelection[] };
export type AllocationShortfall = { sku: string; missing: number; reason: string };
export type SkippedLot = { lotId: string; sku: string; warehouse: string; reason: string };
export type AllocationPlan = { id: string; tenantId: string; orderId: string; status: 'full' | 'partial' | 'unavailable'; onPartial: 'fail' | 'backorder'; reservationTtlHours: number; lines: AllocationPlanLine[]; shortfalls: AllocationShortfall[]; skippedLots: SkippedLot[]; plannedAt: string };
export type AllocationConflict = { lotId: string; sku: string; quantity: number; reason: 'LOT_NOT_FOUND' | 'VERSION_MISMATCH' | 'INSUFFICIENT_FREE'; expectedVersion?: number; actualVersion?: number; free?: number };
export type AllocationResult = { ok: true; order: Order; reservations: Reservation[]; plan: AllocationPlan } | { ok: false; code: 'ALLOCATION_CONFLICT' | 'INSUFFICIENT_STOCK' | 'ORDER_STATE_CONFLICT'; message: string; conflicts?: AllocationConflict[]; shortfalls?: AllocationShortfall[] };
export class AllocationError extends Error { readonly code: string; readonly details?: unknown; constructor(code: string, message: string, details?: unknown) { super(message); this.name = 'AllocationError'; this.code = code; this.details = details; } }

const ORIGIN_WAREHOUSE: Record<string, string> = { '上海保税区': 'SHANGHAI-FTZ', '鹿特丹': 'ROTTERDAM-DC', '洛杉矶': 'LOS-ANGELES-DC' };
const WAREHOUSE_CAPACITY_KG: Record<string, number> = { 'SHANGHAI-FTZ': 5000, 'ROTTERDAM-DC': 3000, 'LOS-ANGELES-DC': 2000 };
const RESERVATION_TTL_HOURS: Record<Order['priority'], number> = { critical: 6, urgent: 24, standard: 72 };
const lotFree = (lot: InventoryLot) => lot.available - lot.reserved;

// 候选阶段：只读取 InventoryLot 与现有 reservation，计算候选方案并说明每个 lot 被选中或被跳过的原因，不写任何状态。
export function planAllocation(tenantId: string, orderId: string, options: { onPartial?: 'fail' | 'backorder' } = {}): AllocationPlan {
  tenant(tenantId);
  const order = orderFor(tenantId, orderId);
  if (!['confirmed', 'backordered'].includes(order.status)) throw new Error(`订单当前状态 ${order.status} 不能规划库存分配`);
  const plannedAt = now();
  const homeWarehouse = ORIGIN_WAREHOUSE[order.origin];
  const lines: AllocationPlanLine[] = [];
  const shortfalls: AllocationShortfall[] = [];
  const skippedLots: SkippedLot[] = [];
  for (const item of order.items) {
    const alreadyReserved = state.reservations.filter(value => value.tenantId === tenantId && value.orderId === orderId && value.sku === item.sku && value.status === 'active').reduce((sum, value) => sum + value.quantity, 0);
    let remaining = item.quantity - alreadyReserved;
    const line: AllocationPlanLine = { sku: item.sku, requested: item.quantity, alreadyReserved, allocated: 0, selections: [] };
    const candidates = state.inventory.filter(lot => lot.tenantId === tenantId && lot.sku === item.sku).map(lot => ({ lot, free: lotFree(lot) })).sort((a, b) => {
      const homeDelta = (a.lot.warehouse === homeWarehouse ? 0 : 1) - (b.lot.warehouse === homeWarehouse ? 0 : 1);
      if (homeDelta) return homeDelta;
      const expiryDelta = (a.lot.expiresAt ?? '9999-12-31').localeCompare(b.lot.expiresAt ?? '9999-12-31');
      return expiryDelta || b.free - a.free;
    });
    for (const { lot, free } of candidates) {
      if (remaining <= 0) break;
      if (lot.expiresAt && lot.expiresAt <= plannedAt) { skippedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `批次 ${lot.lotCode} 已于 ${lot.expiresAt.slice(0, 10)} 过期，不满足批次合规` }); continue; }
      if (free <= 0) { skippedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: '可用量已被其他订单预留' }); continue; }
      const capacity = WAREHOUSE_CAPACITY_KG[lot.warehouse];
      if (capacity !== undefined && order.totalWeightKg > capacity) { skippedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `订单总重 ${order.totalWeightKg}kg 超出 ${lot.warehouse} 承运能力 ${capacity}kg` }); continue; }
      const quantity = Math.min(remaining, free);
      const reasons = [lot.warehouse === homeWarehouse ? `仓库 ${lot.warehouse} 与运输起点「${order.origin}」一致，优先本地履约` : `本地仓不足，从 ${lot.warehouse} 跨仓调拨`, lot.expiresAt ? `FEFO：批次 ${lot.lotCode} ${lot.expiresAt.slice(0, 10)} 到期，先到期先出` : `批次 ${lot.lotCode} 无有效期限制`, `订单优先级 ${order.priority}，预留有效期 ${RESERVATION_TTL_HOURS[order.priority]} 小时`, `可用 ${free}，本次计划占用 ${quantity}`];
      line.selections.push({ lotId: lot.id, warehouse: lot.warehouse, lotCode: lot.lotCode, sku: item.sku, quantity, lotVersion: lot.version, freeAtPlan: free, expiresAt: lot.expiresAt, reasons });
      line.allocated += quantity;
      remaining -= quantity;
    }
    if (remaining > 0) shortfalls.push({ sku: item.sku, missing: remaining, reason: '全部候选批次可用量之和不足' });
    lines.push(line);
  }
  const allocatedTotal = lines.reduce((sum, line) => sum + line.allocated, 0);
  const status: AllocationPlan['status'] = shortfalls.length === 0 ? 'full' : allocatedTotal > 0 ? 'partial' : 'unavailable';
  return { id: id('PLAN'), tenantId, orderId, status, onPartial: options.onPartial ?? 'fail', reservationTtlHours: RESERVATION_TTL_HOURS[order.priority], lines, shortfalls, skippedLots, plannedAt };
}

// 确认阶段：原子校验所有 lot 的版本与可用量，全部通过才为全部 lot 建立 reservation；任一失败则整单不生效并返回可识别的冲突结果。
export function confirmAllocationPlan(tenantId: string, orderId: string, plan: AllocationPlan, actor = 'system'): AllocationResult {
  const order = orderFor(tenantId, orderId);
  if (plan.tenantId !== tenantId || plan.orderId !== orderId) throw new Error('分配计划与订单不匹配');
  if (!['confirmed', 'backordered'].includes(order.status)) return { ok: false, code: 'ORDER_STATE_CONFLICT', message: `订单当前状态 ${order.status} 不能确认库存分配` };
  if (plan.status !== 'full' && plan.onPartial === 'fail') {
    const message = plan.shortfalls.map(item => `库存不足：${item.sku} 还缺少 ${item.missing}`).join('；');
    record(tenantId, actor, 'order.allocation.failed', 'order', order.id, undefined, { planId: plan.id, shortfalls: plan.shortfalls });
    return { ok: false, code: 'INSUFFICIENT_STOCK', message, shortfalls: plan.shortfalls };
  }
  const conflicts: AllocationConflict[] = [];
  for (const line of plan.lines) for (const selection of line.selections) {
    const lot = state.inventory.find(value => value.tenantId === tenantId && value.id === selection.lotId);
    if (!lot) { conflicts.push({ lotId: selection.lotId, sku: line.sku, quantity: selection.quantity, reason: 'LOT_NOT_FOUND' }); continue; }
    const free = lotFree(lot);
    if (lot.version !== selection.lotVersion) conflicts.push({ lotId: lot.id, sku: line.sku, quantity: selection.quantity, reason: 'VERSION_MISMATCH', expectedVersion: selection.lotVersion, actualVersion: lot.version, free });
    else if (free < selection.quantity) conflicts.push({ lotId: lot.id, sku: line.sku, quantity: selection.quantity, reason: 'INSUFFICIENT_FREE', expectedVersion: selection.lotVersion, actualVersion: lot.version, free });
  }
  if (conflicts.length) {
    record(tenantId, actor, 'order.allocation.conflicted', 'order', order.id, undefined, { planId: plan.id, conflicts });
    return { ok: false, code: 'ALLOCATION_CONFLICT', message: '库存已被并发请求变更，本次确认未生效，请重新规划后重试', conflicts };
  }
  const before = clone(order);
  const expiresAt = new Date(Date.now() + plan.reservationTtlHours * 3600000).toISOString();
  const reservations: Reservation[] = plan.lines.flatMap(line => line.selections.map(selection => ({ id: id('RSV'), tenantId, orderId, lotId: selection.lotId, sku: line.sku, quantity: selection.quantity, status: 'active' as const, expiresAt, createdAt: now() })));
  for (const reservation of reservations) { const lot = state.inventory.find(value => value.id === reservation.lotId)!; lot.reserved += reservation.quantity; lot.version += 1; }
  state.reservations.push(...reservations);
  transition(order, plan.status === 'full' ? 'allocated' : 'backordered');
  mutate(tenantId, actor, plan.status === 'full' ? 'order.allocated' : 'order.backordered', 'order', order.id, before, { order, reservations, shortfalls: plan.shortfalls, planId: plan.id }, 'inventory.reserved');
  return { ok: true, order: clone(order), reservations: clone(reservations), plan };
}

export function allocateOrder(tenantId: string, orderId: string, actor = 'system', options: { onPartial?: 'fail' | 'backorder' } = {}) {
  const plan = planAllocation(tenantId, orderId, options);
  const result = confirmAllocationPlan(tenantId, orderId, plan, actor);
  if (!result.ok) throw new AllocationError(result.code, result.message, result);
  return result.order;
}

function releaseOrderReservations(tenantId: string, orderId: string, reason: string) {
  const releases: { reservationId: string; lotId: string; sku: string; quantity: number }[] = [];
  for (const reservation of state.reservations.filter(item => item.tenantId === tenantId && item.orderId === orderId && item.status === 'active')) {
    const lot = state.inventory.find(item => item.id === reservation.lotId);
    if (lot) { lot.reserved = Math.max(0, lot.reserved - reservation.quantity); lot.version += 1; }
    reservation.status = 'released';
    reservation.releaseReason = reason;
    releases.push({ reservationId: reservation.id, lotId: reservation.lotId, sku: reservation.sku, quantity: reservation.quantity });
  }
  return releases;
}

// 整单失败：释放全部 active 预留、按真实数量回补 lot、回退已占用授信，并让 audit 与 outbox 记录同一笔决策。
function failOrder(tenantId: string, order: Order, reason: string, releaseReason: string, actor: string) {
  const before = clone(order);
  const releases = releaseOrderReservations(tenantId, order.id, releaseReason);
  transition(order, 'cancelled');
  if (before.status !== 'draft') { const customer = customerFor(tenantId, order.customerId); customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); }
  mutate(tenantId, actor, 'order.cancelled', 'order', order.id, before, { order, releases, reason }, 'order.cancelled');
}

// 预留过期清理：释放过期预留；allocated 订单失去库存保障后明确进入待补货，可随后重新分配。
export function sweepExpiredReservations(tenantId: string, asOf?: string, actor = 'system') {
  tenant(tenantId);
  const cutoff = asOf ?? now();
  const expired = state.reservations.filter(item => item.tenantId === tenantId && item.status === 'active' && item.expiresAt && item.expiresAt <= cutoff);
  const byOrder = new Map<string, Reservation[]>();
  for (const reservation of expired) { const list = byOrder.get(reservation.orderId) ?? []; list.push(reservation); byOrder.set(reservation.orderId, list); }
  const outcomes: { orderId: string; orderStatus: OrderStatus; releases: { reservationId: string; lotId: string; sku: string; quantity: number }[] }[] = [];
  for (const [orderId, reservations] of byOrder) {
    const order = state.orders.find(item => item.id === orderId);
    const releases: { reservationId: string; lotId: string; sku: string; quantity: number }[] = [];
    for (const reservation of reservations) {
      const lot = state.inventory.find(item => item.id === reservation.lotId);
      if (lot) { lot.reserved = Math.max(0, lot.reserved - reservation.quantity); lot.version += 1; }
      reservation.status = 'released';
      reservation.releaseReason = 'expired';
      releases.push({ reservationId: reservation.id, lotId: reservation.lotId, sku: reservation.sku, quantity: reservation.quantity });
    }
    if (order && order.status === 'allocated') {
      const before = clone(order);
      transition(order, 'backordered');
      mutate(tenantId, actor, 'order.backordered', 'order', order.id, before, { order, releases, reason: '库存预留过期，订单进入待补货' }, 'inventory.reservation.expired');
    } else if (order) {
      record(tenantId, actor, 'inventory.reservation.expired', 'order', order.id, undefined, { releases, reason: '库存预留过期' });
    }
    if (order) outcomes.push({ orderId, orderStatus: order.status, releases });
  }
  return { sweptAt: cutoff, releasedCount: expired.length, orders: outcomes };
}

export function listReservations(tenantId: string, orderId: string) { const order = orderFor(tenantId, orderId); return state.reservations.filter(item => item.tenantId === tenantId && item.orderId === order.id).map(clone); }
export function dispatchOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const customs = state.customs.find(item => item.orderId === orderId); if (!customs || customs.status !== 'cleared') throw new Error('海关申报尚未放行'); const reservations = state.reservations.filter(item => item.orderId === orderId && item.status === 'active'); if (!reservations.length) throw new Error('订单没有有效库存分配'); const expiredReservations = reservations.filter(item => item.expiresAt && item.expiresAt <= now()); if (expiredReservations.length) throw new AllocationError('RESERVATION_EXPIRED', `订单有 ${expiredReservations.length} 笔库存预留已过期，请先执行过期清理并重新分配`, { reservationIds: expiredReservations.map(item => item.id) }); const before = clone(order); transition(order, 'dispatched'); reservations.forEach(reservation => { const lot = state.inventory.find(item => item.id === reservation.lotId)!; lot.available -= reservation.quantity; lot.reserved -= reservation.quantity; lot.version += 1; reservation.status = 'consumed'; }); const shipment: Shipment = { id: id('SHP'), tenantId, orderId, trackingNo: `CBF${Date.now().toString().slice(-8)}`, legs: [{ id: id('LEG'), mode: 'truck', origin: order.origin, destination: '出口口岸', plannedDeparture: now(), plannedArrival: new Date(Date.now() + 86400000).toISOString(), status: 'planned' }, { id: id('LEG'), mode: 'sea', origin: '出口口岸', destination: order.destination, plannedDeparture: new Date(Date.now() + 172800000).toISOString(), plannedArrival: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned' }], currentLocation: order.origin, eta: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned', events: [] }; state.shipments.push(shipment); order.shipmentId = shipment.id; mutate(tenantId, actor, 'order.dispatched', 'order', order.id, before, { order, shipment }, 'shipment.created'); return clone(order); }
export function deliverOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const shipment = state.shipments.find(item => item.orderId === orderId); if (!shipment) throw new Error('运输单不存在'); const before = clone(order); transition(order, 'delivered'); shipment.status = 'delivered'; shipment.currentLocation = order.destination; shipment.events.push({ id: id('TRK'), code: 'DELIVERED', location: order.destination, occurredAt: now(), note: '签收完成' }); mutate(tenantId, actor, 'order.delivered', 'order', order.id, before, { order, shipment }, 'shipment.delivered'); return clone(order); }
export function closeOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (!invoice || invoice.status !== 'paid') throw new Error('发票未完成收款核销'); const before = clone(order); transition(order, 'closed'); const customer = customerFor(tenantId, order.customerId); customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.closed', 'order', order.id, before, order, 'order.closed'); return clone(order); }
export function cancelOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); if (['dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('已出运订单不能取消'); failOrder(tenantId, order, '订单被取消', 'cancelled', actor); return clone(order); }

export function createCustomsDeclaration(tenantId: string, input: { orderId: string; country?: string; requiredDocuments?: string[] }, actor = 'system') { const order = orderFor(tenantId, input.orderId); if (state.customs.some(item => item.orderId === order.id)) throw new Error('订单已有海关申报'); const declaration: CustomsDeclaration = { id: id('CUS'), tenantId, orderId: order.id, country: input.country ?? order.destination, status: 'draft', documentRefs: [], requiredDocuments: input.requiredDocuments ?? ['commercial-invoice', 'packing-list', 'origin-certificate'], riskScore: order.priority === 'critical' ? 82 : order.totalWeightKg > 1000 ? 60 : 24, updatedAt: now() }; state.customs.push(declaration); order.customsDeclarationId = declaration.id; mutate(tenantId, actor, 'customs.created', 'customs', declaration.id, undefined, declaration, 'customs.created'); return clone(declaration); }
export function updateCustoms(tenantId: string, declarationId: string, input: { status?: CustomsStatus; documentRefs?: string[]; rejectionReason?: string }, actor = 'system') { const declaration = assertTenant(state.customs.find(item => item.id === declarationId) ?? (() => { throw new Error('海关申报不存在'); })(), tenantId); const before = clone(declaration); if (input.documentRefs) declaration.documentRefs = [...new Set(input.documentRefs)]; if (input.status) { if (input.status === 'cleared' && declaration.requiredDocuments.some(doc => !declaration.documentRefs.includes(doc))) throw new Error('放行前必须补齐所有必需单证'); if (input.status === 'inspection' && declaration.status !== 'submitted') throw new Error('只有已提交申报才能进入查验'); declaration.status = input.status; } declaration.rejectionReason = input.rejectionReason; if (input.status === 'rejected') { const order = state.orders.find(item => item.id === declaration.orderId); if (order && ['confirmed', 'allocated', 'backordered'].includes(order.status)) failOrder(tenantId, order, `海关申报 ${declaration.id} 未放行（${input.rejectionReason ?? '未说明原因'}）`, 'customs_rejected', actor); } declaration.updatedAt = now(); mutate(tenantId, actor, 'customs.updated', 'customs', declaration.id, before, declaration, 'customs.updated'); return clone(declaration); }
export function addShipmentEvent(tenantId: string, shipmentId: string, input: { code: string; location: string; occurredAt?: string; note?: string }, actor = 'system') { const shipment = assertTenant(state.shipments.find(item => item.id === shipmentId) ?? (() => { throw new Error('运输单不存在'); })(), tenantId); if (!input.code || !input.location) throw new Error('轨迹编码和位置不能为空'); const event = { id: id('TRK'), code: input.code, location: input.location, occurredAt: input.occurredAt ?? now(), note: input.note }; shipment.events.push(event); shipment.currentLocation = input.location; if (input.code === 'DEPARTED') { shipment.status = 'in_transit'; shipment.legs[0].status = 'in_transit'; } if (input.code === 'DELAYED') { shipment.status = 'exception'; shipment.legs.find(leg => leg.status !== 'arrived')!.status = 'delayed'; createApproval(tenantId, { orderId: shipment.orderId, type: 'delay_compensation', reason: `运输轨迹 ${shipment.trackingNo} 发生延误` }, actor); } if (input.code === 'ARRIVED') shipment.legs[shipment.legs.length - 1].status = 'arrived'; record(tenantId, actor, 'shipment.event.added', 'shipment', shipment.id, undefined, event); emit(tenantId, 'shipment.event.added', shipment.id, event); return clone(shipment); }

export function generateInvoice(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const existing = state.invoices.find(item => item.orderId === orderId); if (existing) return clone(existing); if (!['allocated', 'dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('订单完成库存分配后才能开票'); const freight = money(Math.max(120, order.totalWeightKg * (order.priority === 'critical' ? 4.2 : 2.1))); const fuel = money(freight * 0.13); const customsFee = money(95 + order.items.length * 25); const lines: InvoiceLine[] = [{ code: 'GOODS', description: '货物服务费', quantity: 1, unitPrice: order.subtotal, amount: order.subtotal }, { code: 'FREIGHT', description: '跨境运输费', quantity: 1, unitPrice: freight, amount: freight }, { code: 'FUEL', description: '燃油附加费', quantity: 1, unitPrice: fuel, amount: fuel }, { code: 'CUSTOMS', description: '关务服务费', quantity: 1, unitPrice: customsFee, amount: customsFee }]; const subtotal = money(lines.reduce((sum, line) => sum + line.amount, 0)); const tax = money(subtotal * 0.06); const invoice: Invoice = { id: id('INV'), tenantId, orderId, number: `INV-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(5, '0')}`, status: 'issued', currency: order.currency, lines, subtotal, tax, total: money(subtotal + tax), paid: 0, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), createdAt: now() }; state.invoices.push(invoice); order.invoiceId = invoice.id; mutate(tenantId, actor, 'invoice.issued', 'invoice', invoice.id, undefined, invoice, 'invoice.issued'); return clone(invoice); }
export function recordPayment(tenantId: string, input: { invoiceId: string; amount: number; method: Payment['method']; reference: string }, actor = 'system') { const invoice = assertTenant(state.invoices.find(item => item.id === input.invoiceId) ?? (() => { throw new Error('发票不存在'); })(), tenantId); if (!input.amount || input.amount <= 0 || input.amount > invoice.total - invoice.paid + 0.01) throw new Error('收款金额超过发票未核销余额'); const before = clone(invoice); const payment: Payment = { id: id('PAY'), tenantId, invoiceId: invoice.id, amount: money(input.amount), method: input.method, reference: input.reference, receivedAt: now() }; state.payments.push(payment); invoice.paid = money(invoice.paid + payment.amount); invoice.status = invoice.paid >= invoice.total - 0.01 ? 'paid' : 'partially_paid'; if (invoice.status === 'paid') { const order = state.orders.find(item => item.id === invoice.orderId); if (order) order.status = 'closed'; } mutate(tenantId, actor, 'payment.recorded', 'invoice', invoice.id, before, invoice, 'payment.recorded'); return clone(payment); }

export function createApproval(tenantId: string, input: { orderId: string; type: Approval['type']; reason: string }, actor = 'system') { orderFor(tenantId, input.orderId); const approval: Approval = { id: id('APR'), tenantId, orderId: input.orderId, type: input.type, reason: input.reason, status: 'pending', createdAt: now() }; state.approvals.push(approval); record(tenantId, actor, 'approval.created', 'approval', approval.id, undefined, approval); emit(tenantId, 'approval.created', approval.id, approval); return clone(approval); }
export function decideApproval(tenantId: string, approvalId: string, input: { status: Exclude<ApprovalStatus, 'pending'>; comment?: string }, actor: string) { const approval = assertTenant(state.approvals.find(item => item.id === approvalId) ?? (() => { throw new Error('审批不存在'); })(), tenantId); if (approval.status !== 'pending') throw new Error('审批已经决策'); const before = clone(approval); approval.status = input.status; approval.decidedBy = actor; approval.comment = input.comment; approval.decidedAt = now(); if (input.status === 'approved' && approval.type === 'credit_override') { const order = orderFor(tenantId, approval.orderId); const customer = customerFor(tenantId, order.customerId); customer.creditLimit = Math.max(customer.creditLimit, customer.creditUsed + order.totalAmount); } if (input.status === 'rejected' && approval.type === 'credit_override') { const order = orderFor(tenantId, approval.orderId); if (['draft', 'confirmed', 'backordered'].includes(order.status)) failOrder(tenantId, order, `信用审批 ${approval.id} 未通过`, 'credit_rejected', actor); } mutate(tenantId, actor, 'approval.decided', 'approval', approval.id, before, approval, 'approval.decided'); return clone(approval); }

export function operationSummary(tenantId: string) { tenant(tenantId); const orders = listOrders(tenantId); const invoices = state.invoices.filter(item => item.tenantId === tenantId); const shipments = state.shipments.filter(item => item.tenantId === tenantId); return { tenantId, generatedAt: now(), orderCount: orders.length, byStatus: orders.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}), grossMerchandiseValue: money(orders.reduce((sum, item) => sum + item.totalAmount, 0)), receivable: money(invoices.reduce((sum, item) => sum + item.total - item.paid, 0)), paid: money(invoices.reduce((sum, item) => sum + item.paid, 0)), delayedShipments: shipments.filter(item => item.status === 'exception').length, pendingApprovals: state.approvals.filter(item => item.tenantId === tenantId && item.status === 'pending').length, inventory: state.inventory.filter(item => item.tenantId === tenantId).map(item => ({ warehouse: item.warehouse, sku: item.sku, available: item.available, reserved: item.reserved, free: item.available - item.reserved, version: item.version })) }; }
export function timeline(tenantId: string, orderId: string) { const order = orderFor(tenantId, orderId); const relatedIds = new Set([order.id]); const shipment = state.shipments.find(item => item.orderId === orderId); const customs = state.customs.find(item => item.orderId === orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (shipment) relatedIds.add(shipment.id); if (customs) relatedIds.add(customs.id); if (invoice) relatedIds.add(invoice.id); state.approvals.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id)); return state.audit.filter(item => item.tenantId === tenantId && relatedIds.has(item.entityId)).sort((a, b) => b.at.localeCompare(a.at)).map(clone); }
export function listAudit(tenantId: string, limit = 100) { tenant(tenantId); return state.audit.filter(item => item.tenantId === tenantId).slice(0, Math.min(limit, 500)).map(clone); }
export function listOutbox(tenantId: string, status?: OutboxEvent['status']) { tenant(tenantId); return state.outbox.filter(item => (!status || item.status === status)).map(clone); }
export function publishOutbox(tenantId: string, eventId: string, actor = 'system') { const event = assertTenant(state.outbox.find(item => item.id === eventId) ?? (() => { throw new Error('事件不存在'); })(), tenantId); if (event.status === 'published') return clone(event); event.status = 'published'; event.attempts += 1; record(tenantId, actor, 'outbox.published', 'outbox', event.id, { status: 'pending' }, event); return clone(event); }


export type OrderPage = { items: Order[]; nextCursor?: string; total: number };
export function listOrdersPage(tenantId: string, input: { cursor?: string; limit?: number } = {}) {
  tenant(tenantId);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
  const ordered = state.orders.filter(item => item.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items = ordered.slice(offset, offset + limit).map(clone);
  return { items, nextCursor: offset + limit < ordered.length ? String(offset + limit) : undefined, total: ordered.length };
}
export function invoiceOverdue(tenantId: string, invoiceId: string, asOf = new Date()) {
  const invoice = assertTenant(state.invoices.find(item => item.id === invoiceId) ?? (() => { throw new Error('发票不存在'); })(), tenantId);
  const order = orderFor(tenantId, invoice.orderId);
  const customer = customerFor(tenantId, order.customerId);
  const customerDate = asOf.toISOString().slice(0, 10);
  return { invoiceId, overdue: customerDate > invoice.dueDate.slice(0, 10), evaluatedDate: customerDate, customerTimezone: customer.timezone ?? 'UTC' };
}

// seed a coherent flow for demos: one order is allocated, one customs declaration is cleared, and one invoice is partially paid.
const seeded = createOrder('tenant-acme', { customerId: 'CUS-001', reference: 'PO-2026-0918', origin: '上海保税区', destination: '鹿特丹', priority: 'urgent', items: [{ sku: 'SENSOR-X9', description: '工业温度传感器', quantity: 10, unitPrice: 180, weightKg: 2.4, hsCode: '9025.19' }, { sku: 'CONTROL-M2', description: '边缘控制模块', quantity: 4, unitPrice: 420, weightKg: 3.2, hsCode: '8537.10' }] });
confirmOrder('tenant-acme', seeded.id); allocateOrder('tenant-acme', seeded.id); const seededDeclaration = createCustomsDeclaration('tenant-acme', { orderId: seeded.id }); updateCustoms('tenant-acme', seededDeclaration.id, { documentRefs: ['commercial-invoice', 'packing-list', 'origin-certificate'], status: 'submitted' }); updateCustoms('tenant-acme', seededDeclaration.id, { status: 'cleared' }); dispatchOrder('tenant-acme', seeded.id); const seededInvoice = generateInvoice('tenant-acme', seeded.id); recordPayment('tenant-acme', { invoiceId: seededInvoice.id, amount: 500, method: 'bank_transfer', reference: 'BANK-DEMO-001' });
