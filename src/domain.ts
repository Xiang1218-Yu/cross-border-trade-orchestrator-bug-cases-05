import { randomUUID } from 'node:crypto';

export type OrderStatus = 'draft' | 'confirmed' | 'allocated' | 'backordered' | 'dispatched' | 'delivered' | 'closed' | 'cancelled';
export type CustomsStatus = 'draft' | 'submitted' | 'inspection' | 'cleared' | 'rejected';
export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

type Tenant = { id: string; name: string; creditLimit: number; creditUsed: number; currency: string };
type Customer = { id: string; tenantId: string; name: string; creditLimit: number; creditUsed: number; blocked: boolean; timezone?: string };
type OrderItem = { sku: string; description: string; quantity: number; unitPrice: number; weightKg: number; hsCode: string };

/** 库存整批（lot）。version 为乐观锁：候选阶段记录快照版本，确认阶段必须仍等于该版本。 */
export type InventoryLot = {
  id: string; tenantId: string; warehouse: string; sku: string;
  available: number; reserved: number; version: number;
  lotCode: string; expiresAt?: string;
};

export type Reservation = {
  id: string; tenantId: string; orderId: string; lotId: string; sku: string;
  quantity: number;
  status: 'active' | 'released' | 'consumed';
  /** 占用的承运能力通道；释放/取消时按同一通道归还。 */
  laneId?: string;
  expiresAt?: string;
  releasedReason?: ReleaseReason;
  createdAt: string;
};

/** 承运能力通道：某仓库到某目的地的可承载量，used 同时包含已预留与已出运消耗。 */
export type CarrierLane = {
  id: string; tenantId: string; warehouse: string; destination: string;
  carrier: string; mode: ShipmentLeg['mode'];
  capacity: number; used: number; version: number;
};

export type AllocationMode = 'full' | 'partial';
export type AllocationPlanStatus = 'proposed' | 'confirmed' | 'conflicted' | 'superseded' | 'failed';

export type AllocationCandidate = {
  lotId: string; warehouse: string; sku: string; lotCode: string;
  quantity: number;
  freeAtPlan: number; lotVersion: number; expiresAt?: string;
  laneId?: string; laneRemaining: number;
  /** 选择该 lot 的可解释原因（起点匹配/FEFO/批次合规/承运能力）。 */
  reasons: string[];
};

export type AllocationPlanLine = {
  sku: string; required: number;
  candidates: AllocationCandidate[];
  /** 该行在候选阶段无法满足的数量。 */
  short: number;
};

export type AllocationShortage = { sku: string; required: number; satisfiable: number; short: number };

export type AllocationPlan = {
  id: string; tenantId: string; orderId: string;
  /** 候选阶段看到的订单版本；确认时必须一致，否则说明订单已被别的决策改动。 */
  orderVersion: number;
  mode: AllocationMode;
  status: AllocationPlanStatus;
  lines: AllocationPlanLine[];
  shortages: AllocationShortage[];
  /** 候选阶段是否能整单满足（不写任何库存）。 */
  feasible: boolean;
  reservationTtlMs: number;
  reservationExpiresAt: string;
  conflictCode?: AllocationErrorCode;
  conflictReason?: string;
  conflicts?: AllocationConflictDetail[];
  createdAt: string; decidedAt?: string;
};

/** 订单上留存的、与 reservation/lot/audit/outbox 同源的分配决策快照。 */
export type OrderAllocation = {
  planId: string;
  lines: { sku: string; allocated: number; reservationIds: string[] }[];
  shortages: AllocationShortage[];
  reservedUntil: string;
  updatedAt: string;
};

export type Order = {
  id: string; tenantId: string; customerId: string; reference: string;
  origin: string; destination: string;
  priority: 'standard' | 'urgent' | 'critical';
  status: OrderStatus;
  items: OrderItem[];
  totalWeightKg: number; subtotal: number; totalAmount: number; currency: string;
  version: number;
  shipmentId?: string; customsDeclarationId?: string; invoiceId?: string;
  allocation?: OrderAllocation;
  /** 整单失败原因（信用拒绝/报关拒收等）。 */
  failureReason?: string;
  createdAt: string; updatedAt: string;
};

type ShipmentLeg = { id: string; mode: 'truck' | 'rail' | 'sea' | 'air'; origin: string; destination: string; plannedDeparture: string; plannedArrival: string; actualArrival?: string; status: 'planned' | 'in_transit' | 'arrived' | 'delayed' };
type Shipment = { id: string; tenantId: string; orderId: string; trackingNo: string; legs: ShipmentLeg[]; currentLocation: string; eta: string; status: 'planned' | 'in_transit' | 'delivered' | 'exception'; events: { id: string; code: string; location: string; occurredAt: string; note?: string }[] };
type CustomsDeclaration = { id: string; tenantId: string; orderId: string; country: string; status: CustomsStatus; documentRefs: string[]; requiredDocuments: string[]; riskScore: number; rejectionReason?: string; updatedAt: string };
type InvoiceLine = { code: string; description: string; quantity: number; unitPrice: number; amount: number };
type Invoice = { id: string; tenantId: string; orderId: string; number: string; status: InvoiceStatus; currency: string; lines: InvoiceLine[]; subtotal: number; tax: number; total: number; paid: number; dueDate: string; createdAt: string };
type Payment = { id: string; tenantId: string; invoiceId: string; amount: number; method: 'bank_transfer' | 'card' | 'credit_note'; reference: string; receivedAt: string };
type Approval = { id: string; tenantId: string; orderId: string; type: 'credit_override' | 'customs_exception' | 'delay_compensation'; reason: string; status: ApprovalStatus; decidedBy?: string; comment?: string; createdAt: string; decidedAt?: string };
export type AuditEvent = { id: string; tenantId: string; actor: string; action: string; entityType: string; entityId: string; orderId?: string; before?: unknown; after?: unknown; at: string };
export type OutboxEvent = { id: string; tenantId: string; topic: string; aggregateId: string; payload: unknown; status: 'pending' | 'published'; attempts: number; createdAt: string };

type State = {
  tenants: Tenant[]; customers: Customer[]; orders: Order[];
  inventory: InventoryLot[]; reservations: Reservation[];
  carrierLanes: CarrierLane[]; allocationPlans: AllocationPlan[];
  shipments: Shipment[]; customs: CustomsDeclaration[];
  invoices: Invoice[]; payments: Payment[]; approvals: Approval[];
  audit: AuditEvent[]; outbox: OutboxEvent[];
};

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const money = (value: number) => Math.round(value * 100) / 100;

/** 预留默认有效期 72 小时；过期由 expireReservations 按真实数量释放。 */
export const RESERVATION_TTL_MS = 72 * 60 * 60 * 1000;

export type ReleaseReason =
  | 'order_cancelled' | 'allocation_failed' | 'reservation_expired'
  | 'customs_rejected' | 'credit_approval_rejected';

/** 可识别的分配失败：竞争方凭 code 区分"再试一次/整单失败/待补货"，且绝不带半成品。 */
export type AllocationErrorCode =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_SUPERSEDED'
  | 'ORDER_VERSION_CONFLICT'
  | 'LOT_VERSION_CONFLICT'
  | 'INSUFFICIENT_FREE_STOCK'
  | 'INSUFFICIENT_CARRIER_CAPACITY'
  | 'LOT_COMPLIANCE_EXPIRED'
  | 'ORDER_NOT_ALLOCATABLE'
  | 'INSUFFICIENT_STOCK';

export type AllocationConflictDetail = {
  lotId?: string; sku?: string; laneId?: string;
  expectedVersion?: number; actualVersion?: number;
  requested?: number; free?: number; capacity?: number; used?: number;
  detail: string;
};

export class AllocationError extends Error {
  readonly code: AllocationErrorCode;
  readonly statusCode: number;
  readonly planId?: string;
  readonly conflicts?: AllocationConflictDetail[];
  constructor(code: AllocationErrorCode, message: string, opts: { planId?: string; conflicts?: AllocationConflictDetail[] } = {}) {
    super(message);
    this.name = 'AllocationError';
    this.code = code;
    this.planId = opts.planId;
    this.conflicts = opts.conflicts;
    this.statusCode = code === 'INSUFFICIENT_STOCK' || code === 'ORDER_NOT_ALLOCATABLE' ? 422 : 409;
  }
}

export const state: State = {
  tenants: [{ id: 'tenant-acme', name: 'Acme Global Trading', creditLimit: 250000, creditUsed: 36200, currency: 'USD' }],
  customers: [
    { id: 'CUS-001', tenantId: 'tenant-acme', name: 'Northstar Retail GmbH', creditLimit: 100000, creditUsed: 12000, blocked: false, timezone: 'Europe/Berlin' },
    { id: 'CUS-002', tenantId: 'tenant-acme', name: 'Pacific Parts Inc.', creditLimit: 50000, creditUsed: 49000, blocked: false, timezone: 'America/Los_Angeles' }
  ],
  orders: [],
  inventory: [
    { id: 'LOT-001', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'SENSOR-X9', available: 80, reserved: 10, version: 1, lotCode: 'SX9-2608', expiresAt: '2026-12-31T00:00:00.000Z' },
    { id: 'LOT-002', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'CONTROL-M2', available: 36, reserved: 4, version: 1, lotCode: 'CM2-2607', expiresAt: '2027-03-31T00:00:00.000Z' },
    { id: 'LOT-003', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', sku: 'SENSOR-X9', available: 12, reserved: 0, version: 1, lotCode: 'SX9-2606', expiresAt: '2026-11-30T00:00:00.000Z' },
    { id: 'LOT-004', tenantId: 'tenant-acme', warehouse: 'LOS-ANGELES', sku: 'SENSOR-X9', available: 20, reserved: 0, version: 1, lotCode: 'SX9-2609', expiresAt: '2027-06-30T00:00:00.000Z' },
    { id: 'LOT-005', tenantId: 'tenant-acme', warehouse: 'LOS-ANGELES', sku: 'CONTROL-M2', available: 15, reserved: 0, version: 1, lotCode: 'CM2-2608', expiresAt: '2027-01-31T00:00:00.000Z' }
  ],
  reservations: [],
  carrierLanes: [
    { id: 'LANE-SH-RTM', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', destination: '鹿特丹', carrier: 'SinoBridge Freight', mode: 'sea', capacity: 200, used: 0, version: 1 },
    { id: 'LANE-SH-HAM', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', destination: '汉堡', carrier: 'SinoBridge Freight', mode: 'sea', capacity: 200, used: 0, version: 1 },
    { id: 'LANE-SH-LAX', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', destination: '洛杉矶', carrier: 'Pacific Rim Line', mode: 'sea', capacity: 120, used: 0, version: 1 },
    { id: 'LANE-SH-ANY', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', destination: '*', carrier: 'SinoBridge Freight', mode: 'sea', capacity: 60, used: 0, version: 1 },
    { id: 'LANE-RTM-RTM', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', destination: '鹿特丹', carrier: 'Rhine Trucking', mode: 'truck', capacity: 100, used: 0, version: 1 },
    { id: 'LANE-RTM-HAM', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', destination: '汉堡', carrier: 'Rhine Trucking', mode: 'truck', capacity: 100, used: 0, version: 1 },
    { id: 'LANE-RTM-ANY', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', destination: '*', carrier: 'Rhine Trucking', mode: 'truck', capacity: 40, used: 0, version: 1 },
    { id: 'LANE-LAX-LAX', tenantId: 'tenant-acme', warehouse: 'LOS-ANGELES', destination: '洛杉矶', carrier: 'BNSF Logistics', mode: 'truck', capacity: 100, used: 0, version: 1 },
    { id: 'LANE-LAX-ANY', tenantId: 'tenant-acme', warehouse: 'LOS-ANGELES', destination: '*', carrier: 'BNSF Logistics', mode: 'truck', capacity: 50, used: 0, version: 1 }
  ],
  allocationPlans: [],
  shipments: [], customs: [], invoices: [], payments: [], approvals: [], audit: [], outbox: []
};

function tenant(id: string) { const value = state.tenants.find(item => item.id === id); if (!value) throw new Error('租户不存在'); return value; }
function assertTenant<T extends { tenantId: string }>(item: T, tenantId: string) { if (item.tenantId !== tenantId) throw new Error('无权访问其他租户的数据'); return item; }
function customerFor(tenantId: string, customerId: string) { const customer = state.customers.find(item => item.id === customerId && item.tenantId === tenantId); if (!customer) throw new Error('客户不存在'); return customer; }
function orderFor(tenantId: string, orderId: string) { const order = state.orders.find(item => item.id === orderId); if (!order) throw new Error('订单不存在'); return assertTenant(order, tenantId); }
function record(tenantId: string, actor: string, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown, orderId?: string) {
  state.audit.unshift({ id: id('AUD'), tenantId, actor, action, entityType, entityId, orderId, before: before === undefined ? undefined : clone(before), after: after === undefined ? undefined : clone(after), at: now() });
}
function emit(tenantId: string, topic: string, aggregateId: string, payload: unknown) { state.outbox.unshift({ id: id('EVT'), tenantId, topic, aggregateId, payload: clone(payload), status: 'pending', attempts: 0, createdAt: now() }); }
function mutate(tenantId: string, actor: string, action: string, type: string, entityId: string, before: unknown, after: unknown, topic: string, orderId?: string) { record(tenantId, actor, action, type, entityId, before, after, orderId); if (action !== 'order.confirmed') emit(tenantId, topic, entityId, after); }
function transition(order: Order, next: OrderStatus) {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['allocated', 'backordered', 'cancelled'],
    allocated: ['dispatched', 'backordered', 'cancelled'],
    backordered: ['allocated', 'cancelled'],
    dispatched: ['delivered'],
    delivered: ['closed', 'dispatched'],
    closed: [],
    cancelled: []
  };
  if (!allowed[order.status].includes(next)) throw new Error(`订单不能从 ${order.status} 变更为 ${next}`);
  order.status = next; order.version += 1; order.updatedAt = now();
}

const lotFree = (lot: InventoryLot) => lot.available - lot.reserved;
const laneRemaining = (lane: CarrierLane) => lane.capacity - lane.used;
const isExpired = (lot: InventoryLot, at: Date) => lot.expiresAt !== undefined && Date.parse(lot.expiresAt) <= at.getTime();

/** 起点别名：订单中文起点与仓库代码归一化，用于同仓优先策略。 */
const WAREHOUSE_ORIGIN_ALIASES: Record<string, string[]> = {
  'SHANGHAI-FTZ': ['上海保税区', '上海', 'SHANGHAI', 'SHANGHAI-FTZ'],
  'ROTTERDAM-DC': ['鹿特丹', 'ROTTERDAM', 'ROTTERDAM-DC'],
  'LOS-ANGELES': ['洛杉矶', 'LOS ANGELES', 'LOS-ANGELES', 'LA']
};
function warehouseServesOrigin(warehouse: string, origin: string) {
  return (WAREHOUSE_ORIGIN_ALIASES[warehouse] ?? []).some(alias => origin.toUpperCase().includes(alias.toUpperCase()));
}

function findLane(tenantId: string, warehouse: string, destination: string): CarrierLane | undefined {
  const lanes = state.carrierLanes.filter(lane => lane.tenantId === tenantId && lane.warehouse === warehouse && laneRemaining(lane) > 0);
  const exact = lanes.filter(lane => lane.destination === destination).sort((a, b) => laneRemaining(b) - laneRemaining(a))[0];
  if (exact) return exact;
  return lanes.filter(lane => lane.destination === '*').sort((a, b) => laneRemaining(b) - laneRemaining(a))[0];
}

export function listOrders(tenantId: string, filters: { status?: string; customerId?: string; q?: string } = {}) { tenant(tenantId); return state.orders.filter(item => item.tenantId === tenantId && (!filters.status || item.status === filters.status) && (!filters.customerId || item.customerId === filters.customerId) && (!filters.q || `${item.reference} ${item.destination}`.toLowerCase().includes(filters.q.toLowerCase()))).map(clone); }
export function getOrder(tenantId: string, orderId: string) { return clone(orderFor(tenantId, orderId)); }
export function createOrder(tenantId: string, input: Partial<Order>, actor = 'system') {
  tenant(tenantId); if (!input.customerId || !input.reference || !input.origin || !input.destination || !input.items?.length) throw new Error('客户、参考号、起讫地和订单明细均不能为空');
  if (state.orders.some(item => item.reference === input.reference)) throw new Error('客户参考号已存在');
  const items = input.items.map(item => { if (!item.sku || !item.quantity || item.quantity <= 0 || !item.unitPrice || item.unitPrice < 0 || !item.weightKg || item.weightKg <= 0) throw new Error('订单明细数量、价格和重量必须为正数'); return { sku: item.sku, description: item.description ?? item.sku, quantity: item.quantity, unitPrice: item.unitPrice, weightKg: item.weightKg, hsCode: item.hsCode ?? '0000.00' }; });
  const subtotal = money(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)); const order: Order = { id: id('ORD'), tenantId, customerId: input.customerId, reference: input.reference, origin: input.origin, destination: input.destination, priority: input.priority ?? 'standard', status: 'draft', items, totalWeightKg: money(items.reduce((sum, item) => sum + item.quantity * item.weightKg, 0)), subtotal, totalAmount: subtotal, currency: input.currency ?? tenant(tenantId).currency, version: 1, createdAt: now(), updatedAt: now() };
  state.orders.unshift(order); mutate(tenantId, actor, 'order.created', 'order', order.id, undefined, order, 'order.created'); return clone(order);
}
export function confirmOrder(tenantId: string, orderId: string, actor = 'system') {
  const order = orderFor(tenantId, orderId);
  if (order.status !== 'draft') throw new Error(`订单不能从 ${order.status} 变更为 confirmed`);
  const before = clone(order);
  const customer = customerFor(tenantId, order.customerId);
  if (customer.blocked) throw new Error('客户已被风控冻结');
  const existingApproval = state.approvals.find(item => item.orderId === orderId && item.type === 'credit_override' && item.status === 'pending');
  if (customer.creditUsed + order.totalAmount > customer.creditLimit && !existingApproval) {
    const approval = createApproval(tenantId, { orderId, type: 'credit_override', reason: '订单金额超过客户授信额度' }, actor);
    throw new Error(`客户授信不足，需要审批 ${approval.id}`);
  }
  if (existingApproval) throw new Error(`客户授信不足，待审批 ${existingApproval.id} 决策后才能确认`);
  transition(order, 'confirmed');
  customer.creditUsed = money(customer.creditUsed + order.totalAmount);
  mutate(tenantId, actor, 'order.confirmed', 'order', order.id, before, order, 'order.confirmed');
  return clone(order);
}

// ---------------------------------------------------------------------------
// 两阶段库存分配
// 阶段一 planOrderAllocation：只读 InventoryLot / CarrierLane，产出候选与选择原因，
//   不写任何库存、不建 reservation。
// 阶段二 confirmOrderAllocation：先对全部 lot/通道做版本与可用量原子校验，
//   任一不满足整体失败（可识别 AllocationError、无半成品）；全部满足才一次性提交。
// ---------------------------------------------------------------------------

type ExcludedLot = { lotId: string; sku: string; warehouse: string; reason: string };

export type AllocationPlanResult = AllocationPlan & { excludedLots: ExcludedLot[] };

function buildPlan(tenantId: string, order: Order, mode: AllocationMode, ttlMs: number, at: Date): AllocationPlanResult {
  // 待补货补货场景：只对尚未被 active reservation 覆盖的缺口再次计算候选。
  const alreadyReserved = new Map<string, number>();
  for (const reservation of state.reservations.filter(item => item.orderId === order.id && item.status === 'active')) {
    alreadyReserved.set(reservation.sku, (alreadyReserved.get(reservation.sku) ?? 0) + reservation.quantity);
  }

  const lines: AllocationPlanLine[] = [];
  const shortages: AllocationShortage[] = [];
  const excludedLots: ExcludedLot[] = [];
  const originFirst = order.priority === 'urgent' || order.priority === 'critical';

  for (const item of order.items) {
    const covered = alreadyReserved.get(item.sku) ?? 0;
    const required = Math.max(0, item.quantity - covered);
    const candidates: AllocationCandidate[] = [];

    if (required > 0) {
      const eligible: { lot: InventoryLot; lane: CarrierLane; reasons: string[] }[] = [];
      for (const lot of state.inventory.filter(value => value.tenantId === tenantId && value.sku === item.sku)) {
        if (isExpired(lot, at)) { excludedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `批次 ${lot.lotCode} 已过有效期（${lot.expiresAt}），批次合规不通过` }); continue; }
        const free = lotFree(lot);
        if (free <= 0) { excludedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `批次 ${lot.lotCode} 可用余量为 0（available=${lot.available}, reserved=${lot.reserved}）` }); continue; }
        const lane = findLane(tenantId, lot.warehouse, order.destination);
        if (!lane) { excludedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `${lot.warehouse} → ${order.destination} 无可用承运通道` }); continue; }
        if (laneRemaining(lane) <= 0) { excludedLots.push({ lotId: lot.id, sku: item.sku, warehouse: lot.warehouse, reason: `承运通道 ${lane.id} 能力已用尽（capacity=${lane.capacity}）` }); continue; }

        const reasons: string[] = [];
        const sameOrigin = warehouseServesOrigin(lot.warehouse, order.origin);
        if (sameOrigin) reasons.push(`仓库 ${lot.warehouse} 与订单起点「${order.origin}」同址，优先从起运地供货以缩短干线时效`);
        else reasons.push(`仓库 ${lot.warehouse} 为异地仓，作为补货备选`);
        if (lot.expiresAt) reasons.push(`批次 ${lot.lotCode} 有效期至 ${lot.expiresAt.slice(0, 10)}，按 FEFO 近效期优先排序`);
        else reasons.push(`批次 ${lot.lotCode} 无有效期限制`);
        reasons.push(lane.destination === '*'
          ? `承运通道 ${lane.id}（${lane.carrier}/${lane.mode}）为通用兜底通道，剩余能力 ${laneRemaining(lane)}`
          : `承运通道 ${lane.id}（${lane.carrier}/${lane.mode}）直达 ${order.destination}，剩余能力 ${laneRemaining(lane)}`);
        if (originFirst && sameOrigin) reasons.push(`订单优先级 ${order.priority}，同仓货源优先级高于 FEFO`);
        eligible.push({ lot, lane, reasons });
      }

      // 排序：紧急/关键订单先看起点同址，再 FEFO；普通订单 FEFO 优先；最后按余量、lotId 兜底保证确定性。
      const expiryKey = (lot: InventoryLot) => lot.expiresAt ? Date.parse(lot.expiresAt) : Number.MAX_SAFE_INTEGER;
      eligible.sort((a, b) => {
        if (originFirst) {
          const oa = warehouseServesOrigin(a.lot.warehouse, order.origin) ? 0 : 1;
          const ob = warehouseServesOrigin(b.lot.warehouse, order.origin) ? 0 : 1;
          if (oa !== ob) return oa - ob;
        }
        const expiry = expiryKey(a.lot) - expiryKey(b.lot);
        if (expiry !== 0) return expiry;
        const freeDiff = lotFree(b.lot) - lotFree(a.lot);
        if (freeDiff !== 0) return freeDiff;
        return a.lot.id.localeCompare(b.lot.id);
      });

      let remaining = required;
      for (const { lot, lane, reasons } of eligible) {
        if (remaining <= 0) break;
        const qty = Math.min(remaining, lotFree(lot), laneRemaining(lane));
        if (qty <= 0) continue;
        candidates.push({
          lotId: lot.id, warehouse: lot.warehouse, sku: item.sku, lotCode: lot.lotCode,
          quantity: qty, freeAtPlan: lotFree(lot), lotVersion: lot.version,
          expiresAt: lot.expiresAt, laneId: lane.id, laneRemaining: laneRemaining(lane),
          reasons: [...reasons, `本批取用 ${qty}（受订单缺口/库存余量/承运能力三者最小值约束）`]
        });
        remaining -= qty;
      }
    }

    const satisfiable = candidates.reduce((sum, candidate) => sum + candidate.quantity, 0);
    const short = Math.max(0, required - satisfiable);
    lines.push({ sku: item.sku, required, candidates, short });
    if (required > 0 || covered > 0) shortages.push({ sku: item.sku, required: item.quantity, satisfiable: covered + satisfiable, short: Math.max(0, item.quantity - covered - satisfiable) });
  }

  const feasible = shortages.every(line => line.short === 0);
  const planId = id('PLAN');
  return {
    id: planId, tenantId, orderId: order.id, orderVersion: order.version,
    mode, status: 'proposed', lines, shortages, feasible,
    reservationTtlMs: ttlMs,
    reservationExpiresAt: new Date(at.getTime() + ttlMs).toISOString(),
    createdAt: at.toISOString(),
    excludedLots
  };
}

/** 阶段一：候选计算。只读库存与通道，落一条可解释的候选记录（audit/outbox），不动一单位库存。 */
export function planOrderAllocation(tenantId: string, orderId: string, input: { mode?: AllocationMode; ttlMs?: number; actor?: string } = {}): AllocationPlanResult {
  const at = new Date();
  const order = orderFor(tenantId, orderId);
  if (!['confirmed', 'backordered'].includes(order.status)) {
    throw new AllocationError('ORDER_NOT_ALLOCATABLE', `订单状态 ${order.status} 不能进行库存分配候选计算（需 confirmed/backordered）`);
  }
  const mode: AllocationMode = input.mode ?? 'full';
  const plan = buildPlan(tenantId, order, mode, input.ttlMs ?? RESERVATION_TTL_MS, at);
  state.allocationPlans.unshift(plan);
  record(tenantId, input.actor ?? 'system', 'allocation.planned', 'allocation_plan', plan.id, undefined, plan, order.id);
  emit(tenantId, 'allocation.proposed', plan.id, { planId: plan.id, orderId: order.id, mode, feasible: plan.feasible, shortages: plan.shortages, candidates: plan.lines, excludedLots: plan.excludedLots });
  return clone(plan);
}

export function listAllocationPlans(tenantId: string, orderId: string) {
  orderFor(tenantId, orderId);
  return state.allocationPlans.filter(plan => plan.tenantId === tenantId && plan.orderId === orderId).map(clone);
}

function supersedeOtherPlans(tenantId: string, orderId: string, decidedPlanId: string) {
  for (const plan of state.allocationPlans) {
    if (plan.tenantId === tenantId && plan.orderId === orderId && plan.id !== decidedPlanId && plan.status === 'proposed') {
      plan.status = 'superseded';
      plan.decidedAt = now();
      plan.conflictReason = `同一订单的候选方案已被 ${decidedPlanId} 抢先确认`;
    }
  }
}

function failPlan(plan: AllocationPlan, code: AllocationErrorCode, message: string, conflicts: AllocationConflictDetail[], actor: string) {
  plan.status = code === 'PLAN_SUPERSEDED' ? 'superseded' : 'conflicted';
  plan.conflictCode = code;
  plan.conflictReason = message;
  plan.conflicts = conflicts;
  plan.decidedAt = now();
  record(plan.tenantId, actor, 'allocation.rejected', 'allocation_plan', plan.id, { status: plan.status }, clone(plan), plan.orderId);
  emit(plan.tenantId, 'allocation.rejected', plan.id, { planId: plan.id, orderId: plan.orderId, code, message, conflicts });
}

/** 阶段二：原子确认。先完成全部版本/可用量/合规/承运能力校验，再一次性建立全部 reservation。 */
export function confirmOrderAllocation(tenantId: string, planId: string, input: { mode?: AllocationMode; actor?: string } = {}) {
  const actor = input.actor ?? 'system';
  const plan = state.allocationPlans.find(item => item.id === planId && item.tenantId === tenantId);
  if (!plan) throw new AllocationError('PLAN_NOT_FOUND', `分配方案 ${planId} 不存在`);
  if (plan.status !== 'proposed') {
    throw new AllocationError('PLAN_SUPERSEDED', `分配方案 ${planId} 已失效（${plan.status}：${plan.conflictReason ?? '已决策'}），请重新计算候选`, { planId });
  }
  const order = state.orders.find(item => item.id === plan.orderId);
  if (!order || order.tenantId !== tenantId) throw new AllocationError('PLAN_NOT_FOUND', '方案对应订单不存在', { planId });

  // ---- 校验阶段：收集全部冲突，不写任何状态 ----
  const conflicts: AllocationConflictDetail[] = [];
  const mode = input.mode ?? plan.mode;

  if (order.version !== plan.orderVersion) {
    conflicts.push({ detail: `订单版本已变化：候选基于 v${plan.orderVersion}，当前 v${order.version}`, expectedVersion: plan.orderVersion, actualVersion: order.version });
  }
  if (!['confirmed', 'backordered'].includes(order.status)) {
    conflicts.push({ detail: `订单当前状态 ${order.status} 不可确认分配` });
  }

  type Prepared = { candidate: AllocationCandidate; lot: InventoryLot; lane?: CarrierLane };
  const prepared: Prepared[] = [];
  const at = new Date();

  for (const line of plan.lines) {
    for (const candidate of line.candidates) {
      const lot = state.inventory.find(item => item.id === candidate.lotId && item.tenantId === tenantId);
      if (!lot) { conflicts.push({ lotId: candidate.lotId, sku: candidate.sku, detail: '候选批次已不存在' }); continue; }
      if (lot.version !== candidate.lotVersion) {
        conflicts.push({ lotId: lot.id, sku: candidate.sku, expectedVersion: candidate.lotVersion, actualVersion: lot.version, detail: `批次 ${lot.lotCode} 版本冲突：候选 v${candidate.lotVersion}，当前 v${lot.version}（已有别的方案先占用）` });
      }
      if (isExpired(lot, at)) {
        conflicts.push({ lotId: lot.id, sku: candidate.sku, detail: `批次 ${lot.lotCode} 现已过有效期，批次合规校验失败` });
      }
      const free = lotFree(lot);
      if (free < candidate.quantity) {
        conflicts.push({ lotId: lot.id, sku: candidate.sku, requested: candidate.quantity, free, detail: `批次 ${lot.lotCode} 可用余量不足：候选需 ${candidate.quantity}，当前仅剩 ${free}` });
      }
      const lane = candidate.laneId ? state.carrierLanes.find(item => item.id === candidate.laneId && item.tenantId === tenantId) : undefined;
      if (candidate.laneId && !lane) {
        conflicts.push({ laneId: candidate.laneId, sku: candidate.sku, detail: '候选承运通道已不存在' });
      } else if (lane) {
        const remaining = laneRemaining(lane);
        if (remaining < candidate.quantity) {
          conflicts.push({ laneId: lane.id, sku: candidate.sku, requested: candidate.quantity, capacity: lane.capacity, used: lane.used, detail: `承运通道 ${lane.id} 能力不足：需 ${candidate.quantity}，剩余 ${remaining}` });
        }
      }
      prepared.push({ candidate, lot, lane });
    }
  }

  if (plan.shortages.some(line => line.short > 0) && mode === 'full') {
    // 候选阶段即不可行：整单失败，无任何写入。
    conflicts.push(...plan.shortages.filter(line => line.short > 0).map(line => ({ sku: line.sku, requested: line.required, free: line.satisfiable, detail: `${line.sku} 全网络缺口 ${line.short}（需求 ${line.required}，候选仅能满足 ${line.satisfiable}）` })));
  }

  if (conflicts.length > 0) {
    const hardConflict = conflicts.some(item => item.detail.includes('版本') || item.detail.includes('通道') || item.detail.includes('余量不足') || item.detail.includes('状态'));
    const code: AllocationErrorCode = conflicts.some(item => item.actualVersion !== undefined && item.lotId)
      ? 'LOT_VERSION_CONFLICT'
      : conflicts.some(item => item.actualVersion !== undefined)
        ? 'ORDER_VERSION_CONFLICT'
        : conflicts.some(item => item.laneId)
          ? 'INSUFFICIENT_CARRIER_CAPACITY'
          : conflicts.some(item => item.detail.includes('有效期'))
            ? 'LOT_COMPLIANCE_EXPIRED'
            : hardConflict
              ? 'INSUFFICIENT_FREE_STOCK'
              : 'INSUFFICIENT_STOCK';
    const message = code === 'INSUFFICIENT_STOCK'
      ? `库存不足，整单分配失败：${conflicts.map(item => item.detail).join('；')}`
      : `分配竞争失败（${code}），未写入任何库存或预留：${conflicts.map(item => item.detail).join('；')}`;
    failPlan(plan, code, message, conflicts, actor);
    throw new AllocationError(code, message, { planId: plan.id, conflicts });
  }

  // ---- 提交阶段：全部校验通过后才执行；一次性为所有 lot 建立 reservation ----
  const beforeOrder = clone(order);
  const newReservations: Reservation[] = [];
  for (const { candidate, lot, lane } of prepared) {
    lot.reserved += candidate.quantity;
    lot.version += 1;
    if (lane) { lane.used += candidate.quantity; lane.version += 1; }
    const reservation: Reservation = {
      id: id('RSV'), tenantId, orderId: order.id, lotId: lot.id, sku: candidate.sku,
      quantity: candidate.quantity, status: 'active', laneId: lane?.id,
      expiresAt: plan.reservationExpiresAt, createdAt: now()
    };
    newReservations.push(reservation);
  }
  state.reservations.push(...newReservations);

  // 汇总订单维度的覆盖情况（合并已有预留——待补货补齐场景）。
  const activeBySku = new Map<string, { qty: number; ids: string[] }>();
  for (const reservation of state.reservations.filter(item => item.orderId === order.id && item.status === 'active')) {
    const entry = activeBySku.get(reservation.sku) ?? { qty: 0, ids: [] };
    entry.qty += reservation.quantity; entry.ids.push(reservation.id);
    activeBySku.set(reservation.sku, entry);
  }
  const allocationLines = order.items.map(item => {
    const entry = activeBySku.get(item.sku) ?? { qty: 0, ids: [] };
    return { sku: item.sku, allocated: Math.min(entry.qty, item.quantity), reservationIds: entry.ids };
  });
  const finalShortages: AllocationShortage[] = order.items.map(item => {
    const allocated = activeBySku.get(item.sku)?.qty ?? 0;
    return { sku: item.sku, required: item.quantity, satisfiable: Math.min(allocated, item.quantity), short: Math.max(0, item.quantity - allocated) };
  });
  const fullyAllocated = finalShortages.every(line => line.short === 0);

  order.allocation = {
    planId: plan.id, lines: allocationLines, shortages: finalShortages,
    reservedUntil: plan.reservationExpiresAt, updatedAt: now()
  };

  if (fullyAllocated) {
    if (order.status !== 'allocated') transition(order, 'allocated');
    else { order.version += 1; order.updatedAt = now(); }
  } else if (mode === 'partial') {
    if (order.status !== 'backordered') transition(order, 'backordered');
    else { order.version += 1; order.updatedAt = now(); }
    order.failureReason = undefined;
  }

  plan.status = 'confirmed';
  plan.decidedAt = now();
  supersedeOtherPlans(tenantId, order.id, plan.id);

  record(tenantId, actor, fullyAllocated ? 'order.allocated' : 'order.backordered', 'order', order.id, beforeOrder, clone({ order, plan, reservations: newReservations }), order.id);
  emit(tenantId, 'inventory.reserved', order.id, {
    planId: plan.id, orderId: order.id, decision: fullyAllocated ? 'allocated' : 'backordered',
    reservations: newReservations.map(item => ({ reservationId: item.id, lotId: item.lotId, sku: item.sku, quantity: item.quantity, laneId: item.laneId, expiresAt: item.expiresAt })),
    shortages: finalShortages,
    reservationExpiresAt: plan.reservationExpiresAt
  });

  return { order: clone(order), plan: clone(plan), reservations: newReservations.map(clone) };
}

/** 兼容旧接口：候选 + 整单确认。竞争失败抛 AllocationError（code 可识别），绝不留下半成品。 */
export function allocateOrder(tenantId: string, orderId: string, actor = 'system') {
  const plan = planOrderAllocation(tenantId, orderId, { mode: 'full', actor });
  return confirmOrderAllocation(tenantId, plan.id, { mode: 'full', actor }).order;
}

/** 待补货订单在库存补充后，按缺口重新候选并确认；仍不足则继续停留在 backordered。 */
export function topUpOrderAllocation(tenantId: string, orderId: string, input: { actor?: string; ttlMs?: number } = {}) {
  const order = orderFor(tenantId, orderId);
  if (order.status !== 'backordered') throw new Error('只有待补货订单可以执行补货分配');
  const plan = planOrderAllocation(tenantId, orderId, { mode: 'partial', ttlMs: input.ttlMs, actor: input.actor ?? 'system' });
  const result = confirmOrderAllocation(tenantId, plan.id, { mode: 'partial', actor: input.actor ?? 'system' });
  return result.order;
}

/** 入库补货：增加已有 lot 可用量或新建 lot，并推进版本，使等待中的候选可重新计算。 */
export function receiveStock(tenantId: string, input: { warehouse: string; sku: string; quantity: number; lotCode?: string; expiresAt?: string }, actor = 'system') {
  tenant(tenantId);
  if (!input.quantity || input.quantity <= 0) throw new Error('入库数量必须为正数');
  let lot = state.inventory.find(item => item.tenantId === tenantId && item.warehouse === input.warehouse && item.sku === input.sku && item.lotCode === input.lotCode);
  const before = lot ? clone(lot) : undefined;
  if (!lot) {
    lot = { id: id('LOT'), tenantId, warehouse: input.warehouse, sku: input.sku, available: 0, reserved: 0, version: 1, lotCode: input.lotCode ?? `${input.sku}-${Date.now().toString(36).toUpperCase()}`, expiresAt: input.expiresAt };
    state.inventory.push(lot);
  }
  lot.available += input.quantity;
  lot.version += 1;
  mutate(tenantId, actor, 'inventory.received', 'lot', lot.id, before, clone(lot), 'inventory.received');
  return clone(lot);
}

/** 按真实数量释放一组预留，同时归还承运能力；返回实际释放明细。 */
function releaseReservations(tenantId: string, reservations: Reservation[], reason: ReleaseReason, actor: string): Reservation[] {
  const released: Reservation[] = [];
  for (const reservation of reservations) {
    if (reservation.status !== 'active') continue;
    const before = clone(reservation);
    const lot = state.inventory.find(item => item.id === reservation.lotId && item.tenantId === tenantId);
    if (lot) { lot.reserved = Math.max(0, lot.reserved - reservation.quantity); lot.version += 1; }
    if (reservation.laneId) {
      const lane = state.carrierLanes.find(item => item.id === reservation.laneId && item.tenantId === tenantId);
      if (lane) { lane.used = Math.max(0, lane.used - reservation.quantity); lane.version += 1; }
    }
    reservation.status = 'released';
    reservation.releasedReason = reason;
    released.push(reservation);
    record(tenantId, actor, 'inventory.released', 'reservation', reservation.id, before, clone(reservation), reservation.orderId);
    emit(tenantId, 'inventory.released', reservation.id, { reservationId: reservation.id, orderId: reservation.orderId, lotId: reservation.lotId, sku: reservation.sku, quantity: reservation.quantity, laneId: reservation.laneId, reason });
  }
  return released;
}

function activeReservationsFor(orderId: string) {
  return state.reservations.filter(item => item.orderId === orderId && item.status === 'active');
}

/** 释放后重算订单覆盖：足额回到 allocated，仍有缺口进入 backordered 并记录真实缺口。 */
function recomputeOrderCoverage(order: Order, actor: string, reason: string) {
  const covered = new Map<string, number>();
  for (const reservation of activeReservationsFor(order.id)) {
    covered.set(reservation.sku, (covered.get(reservation.sku) ?? 0) + reservation.quantity);
  }
  const shortages: AllocationShortage[] = order.items.map(item => {
    const allocated = covered.get(item.sku) ?? 0;
    return { sku: item.sku, required: item.quantity, satisfiable: Math.min(allocated, item.quantity), short: Math.max(0, item.quantity - allocated) };
  });
  const fullyAllocated = shortages.every(line => line.short === 0);
  const before = clone(order);

  if (fullyAllocated && activeReservationsFor(order.id).length > 0) {
    if (order.status === 'backordered') transition(order, 'allocated');
    order.failureReason = undefined;
  } else {
    if (order.status !== 'backordered' && order.status !== 'cancelled') transition(order, 'backordered');
  }

  order.allocation = order.allocation ?? { planId: '', lines: [], shortages, reservedUntil: '', updatedAt: now() };
  order.allocation.lines = order.items.map(item => {
    const ids = activeReservationsFor(order.id).filter(item => item.sku === item.sku).map(item => item.id);
    return { sku: item.sku, allocated: Math.min(covered.get(item.sku) ?? 0, item.quantity), reservationIds: ids };
  });
  order.allocation.shortages = shortages;
  order.allocation.updatedAt = now();

  record(order.tenantId, actor, 'allocation.recomputed', 'order', order.id, before, clone({ order, reason, shortages }), order.id);
  emit(order.tenantId, 'allocation.recomputed', order.id, { orderId: order.id, reason, shortages, status: order.status });
}

/** 预留过期：按真实数量逐笔释放库存与承运能力，再决定订单回 allocated 还是进 backordered。 */
export function expireReservations(tenantId: string, input: { asOf?: string; actor?: string } = {}) {
  tenant(tenantId);
  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  const actor = input.actor ?? 'system';
  const expired = state.reservations.filter(item =>
    item.tenantId === tenantId && item.status === 'active' && item.expiresAt !== undefined && Date.parse(item.expiresAt) <= asOf.getTime());
  if (expired.length === 0) return { asOf: asOf.toISOString(), released: [], affectedOrders: [] };

  const affectedOrderIds = [...new Set(expired.map(item => item.orderId))];
  const released = releaseReservations(tenantId, expired, 'reservation_expired', actor);
  const affectedOrders: string[] = [];
  for (const orderId of affectedOrderIds) {
    const order = state.orders.find(item => item.id === orderId && item.tenantId === tenantId);
    if (!order || ['dispatched', 'delivered', 'closed', 'cancelled'].includes(order.status)) continue;
    recomputeOrderCoverage(order, actor, 'reservation_expired');
    affectedOrders.push(orderId);
  }
  emit(tenantId, 'reservations.expired', tenantId, { asOf: asOf.toISOString(), orderIds: affectedOrderIds, released: released.map(item => ({ reservationId: item.id, orderId: item.orderId, lotId: item.lotId, quantity: item.quantity })) });
  return { asOf: asOf.toISOString(), released: released.map(clone), affectedOrders };
}

/** 整单失败的统一内部通道：取消、释放全部真实占用、归还信用与承运能力、作废旧方案。 */
function failOrderInternal(order: Order, reason: ReleaseReason, actor: string, detail?: string) {
  if (order.status === 'cancelled') return clone(order);
  const before = clone(order);
  if (['dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('已出运订单不能按整单失败取消');

  const active = activeReservationsFor(order.id);
  const released = releaseReservations(order.tenantId, active, reason, actor);
  transition(order, 'cancelled');
  order.failureReason = detail ? `${reason}: ${detail}` : reason;
  for (const plan of state.allocationPlans.filter(item => item.orderId === order.id && item.status === 'proposed')) {
    plan.status = 'superseded'; plan.decidedAt = now(); plan.conflictReason = `订单整单失败（${reason}）`;
  }
  if (before.status !== 'draft') {
    const customer = customerFor(order.tenantId, order.customerId);
    customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount));
  }
  record(order.tenantId, actor, 'order.cancelled', 'order', order.id, before, clone({ order, reason, releasedReservations: released.map(item => item.id) }), order.id);
  emit(order.tenantId, 'order.cancelled', order.id, { orderId: order.id, reason, detail, released: released.map(item => ({ reservationId: item.id, lotId: item.lotId, sku: item.sku, quantity: item.quantity, laneId: item.laneId })) });
  return clone(order);
}

export function dispatchOrder(tenantId: string, orderId: string, actor = 'system') {
  const order = orderFor(tenantId, orderId);
  const customs = state.customs.find(item => item.orderId === orderId);
  if (!customs || customs.status !== 'cleared') throw new Error('海关申报尚未放行');
  const reservations = state.reservations.filter(item => item.orderId === orderId && item.status === 'active');
  if (!reservations.length) throw new Error('订单没有有效库存分配');
  if (order.status !== 'allocated') throw new Error(`订单 ${order.status} 状态下不能出运（存在未补齐缺口）`);
  const before = clone(order);
  transition(order, 'dispatched');
  reservations.forEach(reservation => {
    const lot = state.inventory.find(item => item.id === reservation.lotId)!;
    lot.available -= reservation.quantity;
    lot.reserved -= reservation.quantity;
    lot.version += 1;
    reservation.status = 'consumed';
    // 承运能力的 used 由"预留占用"转为"已出运消耗"，数量不变，无需调整。
  });
  const shipment: Shipment = { id: id('SHP'), tenantId, orderId, trackingNo: `CBF${Date.now().toString().slice(-8)}`, legs: [{ id: id('LEG'), mode: 'truck', origin: order.origin, destination: '出口口岸', plannedDeparture: now(), plannedArrival: new Date(Date.now() + 86400000).toISOString(), status: 'planned' }, { id: id('LEG'), mode: 'sea', origin: '出口口岸', destination: order.destination, plannedDeparture: new Date(Date.now() + 172800000).toISOString(), plannedArrival: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned' }], currentLocation: order.origin, eta: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned', events: [] };
  state.shipments.push(shipment); order.shipmentId = shipment.id;
  mutate(tenantId, actor, 'order.dispatched', 'order', order.id, before, { order, shipment }, 'shipment.created', order.id);
  return clone(order);
}
export function deliverOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const shipment = state.shipments.find(item => item.orderId === orderId); if (!shipment) throw new Error('运输单不存在'); const before = clone(order); transition(order, 'delivered'); shipment.status = 'delivered'; shipment.currentLocation = order.destination; shipment.events.push({ id: id('TRK'), code: 'DELIVERED', location: order.destination, occurredAt: now(), note: '签收完成' }); mutate(tenantId, actor, 'order.delivered', 'order', order.id, before, { order, shipment }, 'shipment.delivered', order.id); return clone(order); }
export function closeOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (!invoice || invoice.status !== 'paid') throw new Error('发票未完成收款核销'); const before = clone(order); transition(order, 'closed'); const customer = customerFor(tenantId, order.customerId); customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.closed', 'order', order.id, before, order, 'order.closed', order.id); return clone(order); }

/** 取消订单：整单失败语义——释放该订单全部 active 预留（多仓多 lot 一笔不漏）、归还承运能力与信用额度。 */
export function cancelOrder(tenantId: string, orderId: string, actor = 'system') {
  const order = orderFor(tenantId, orderId);
  return failOrderInternal(order, 'order_cancelled', actor);
}

export function createCustomsDeclaration(tenantId: string, input: { orderId: string; country?: string; requiredDocuments?: string[] }, actor = 'system') { const order = orderFor(tenantId, input.orderId); if (state.customs.some(item => item.orderId === order.id)) throw new Error('订单已有海关申报'); const declaration: CustomsDeclaration = { id: id('CUS'), tenantId, orderId: order.id, country: input.country ?? order.destination, status: 'draft', documentRefs: [], requiredDocuments: input.requiredDocuments ?? ['commercial-invoice', 'packing-list', 'origin-certificate'], riskScore: order.priority === 'critical' ? 82 : order.totalWeightKg > 1000 ? 60 : 24, updatedAt: now() }; state.customs.push(declaration); order.customsDeclarationId = declaration.id; mutate(tenantId, actor, 'customs.created', 'customs', declaration.id, undefined, declaration, 'customs.created', order.id); return clone(declaration); }
export function updateCustoms(tenantId: string, declarationId: string, input: { status?: CustomsStatus; documentRefs?: string[]; rejectionReason?: string }, actor = 'system') {
  const declaration = assertTenant(state.customs.find(item => item.id === declarationId) ?? (() => { throw new Error('海关申报不存在'); })(), tenantId);
  const before = clone(declaration);
  if (input.documentRefs) declaration.documentRefs = [...new Set(input.documentRefs)];
  if (input.status) {
    if (input.status === 'cleared' && declaration.requiredDocuments.some(doc => !declaration.documentRefs.includes(doc))) throw new Error('放行前必须补齐所有必需单证');
    if (input.status === 'inspection' && declaration.status !== 'submitted') throw new Error('只有已提交申报才能进入查验');
    if (input.status === 'rejected') {
      const order = state.orders.find(item => item.id === declaration.orderId);
      if (order && ['dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('已出运订单的报关拒收必须走异常理赔流程，不能直接拒收');
    }
    declaration.status = input.status;
  }
  declaration.rejectionReason = input.rejectionReason;
  declaration.updatedAt = now();
  mutate(tenantId, actor, 'customs.updated', 'customs', declaration.id, before, declaration, 'customs.updated', declaration.orderId);
  if (input.status === 'rejected') {
    // 报关未放行 = 整单失败：真实数量释放全部预留、归还承运能力与信用，订单取消。
    const order = state.orders.find(item => item.id === declaration.orderId && item.tenantId === tenantId);
    if (order) failOrderInternal(order, 'customs_rejected', actor, input.rejectionReason ?? '海关拒收');
  }
  return clone(declaration);
}
export function addShipmentEvent(tenantId: string, shipmentId: string, input: { code: string; location: string; occurredAt?: string; note?: string }, actor = 'system') { const shipment = assertTenant(state.shipments.find(item => item.id === shipmentId) ?? (() => { throw new Error('运输单不存在'); })(), tenantId); if (!input.code || !input.location) throw new Error('轨迹编码和位置不能为空'); const event = { id: id('TRK'), code: input.code, location: input.location, occurredAt: input.occurredAt ?? now(), note: input.note }; shipment.events.push(event); shipment.currentLocation = input.location; if (input.code === 'DEPARTED') { shipment.status = 'in_transit'; shipment.legs[0].status = 'in_transit'; } if (input.code === 'DELAYED') { shipment.status = 'exception'; shipment.legs.find(leg => leg.status !== 'arrived')!.status = 'delayed'; createApproval(tenantId, { orderId: shipment.orderId, type: 'delay_compensation', reason: `运输轨迹 ${shipment.trackingNo} 发生延误` }, actor); } if (input.code === 'ARRIVED') shipment.legs[shipment.legs.length - 1].status = 'arrived'; record(tenantId, actor, 'shipment.event.added', 'shipment', shipment.id, undefined, event, shipment.orderId); emit(tenantId, 'shipment.event.added', shipment.id, event); return clone(shipment); }

export function generateInvoice(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const existing = state.invoices.find(item => item.orderId === orderId); if (existing) return clone(existing); if (!['allocated', 'dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('订单完成库存分配后才能开票'); const freight = money(Math.max(120, order.totalWeightKg * (order.priority === 'critical' ? 4.2 : 2.1))); const fuel = money(freight * 0.13); const customsFee = money(95 + order.items.length * 25); const lines: InvoiceLine[] = [{ code: 'GOODS', description: '货物服务费', quantity: 1, unitPrice: order.subtotal, amount: order.subtotal }, { code: 'FREIGHT', description: '跨境运输费', quantity: 1, unitPrice: freight, amount: freight }, { code: 'FUEL', description: '燃油附加费', quantity: 1, unitPrice: fuel, amount: fuel }, { code: 'CUSTOMS', description: '关务服务费', quantity: 1, unitPrice: customsFee, amount: customsFee }]; const subtotal = money(lines.reduce((sum, line) => sum + line.amount, 0)); const tax = money(subtotal * 0.06); const invoice: Invoice = { id: id('INV'), tenantId, orderId, number: `INV-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(5, '0')}`, status: 'issued', currency: order.currency, lines, subtotal, tax, total: money(subtotal + tax), paid: 0, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), createdAt: now() }; state.invoices.push(invoice); order.invoiceId = invoice.id; mutate(tenantId, actor, 'invoice.issued', 'invoice', invoice.id, undefined, invoice, 'invoice.issued', orderId); return clone(invoice); }
export function recordPayment(tenantId: string, input: { invoiceId: string; amount: number; method: Payment['method']; reference: string }, actor = 'system') { const invoice = assertTenant(state.invoices.find(item => item.id === input.invoiceId) ?? (() => { throw new Error('发票不存在'); })(), tenantId); if (!input.amount || input.amount <= 0 || input.amount > invoice.total - invoice.paid + 0.01) throw new Error('收款金额超过发票未核销余额'); const before = clone(invoice); const payment: Payment = { id: id('PAY'), tenantId, invoiceId: invoice.id, amount: money(input.amount), method: input.method, reference: input.reference, receivedAt: now() }; state.payments.push(payment); invoice.paid = money(invoice.paid + payment.amount); invoice.status = invoice.paid >= invoice.total - 0.01 ? 'paid' : 'partially_paid'; if (invoice.status === 'paid') { const order = state.orders.find(item => item.id === invoice.orderId); if (order) order.status = 'closed'; } mutate(tenantId, actor, 'payment.recorded', 'invoice', invoice.id, before, invoice, 'payment.recorded', invoice.orderId); return clone(payment); }

export function createApproval(tenantId: string, input: { orderId: string; type: Approval['type']; reason: string }, actor = 'system') { orderFor(tenantId, input.orderId); const approval: Approval = { id: id('APR'), tenantId, orderId: input.orderId, type: input.type, reason: input.reason, status: 'pending', createdAt: now() }; state.approvals.push(approval); record(tenantId, actor, 'approval.created', 'approval', approval.id, undefined, approval, input.orderId); emit(tenantId, 'approval.created', approval.id, approval); return clone(approval); }
export function decideApproval(tenantId: string, approvalId: string, input: { status: Exclude<ApprovalStatus, 'pending'>; comment?: string }, actor: string) {
  const approval = assertTenant(state.approvals.find(item => item.id === approvalId) ?? (() => { throw new Error('审批不存在'); })(), tenantId);
  if (approval.status !== 'pending') throw new Error('审批已经决策');
  const before = clone(approval);
  approval.status = input.status; approval.decidedBy = actor; approval.comment = input.comment; approval.decidedAt = now();
  if (input.status === 'approved' && approval.type === 'credit_override') {
    const order = orderFor(tenantId, approval.orderId);
    const customer = customerFor(tenantId, order.customerId);
    customer.creditLimit = Math.max(customer.creditLimit, customer.creditUsed + order.totalAmount);
  }
  mutate(tenantId, actor, 'approval.decided', 'approval', approval.id, before, approval, 'approval.decided', approval.orderId);
  if (input.status === 'rejected' && approval.type === 'credit_override') {
    // 信用审批被拒 = 整单失败：订单尚在 draft、无库存占用，但必须显式取消并留下可识别决策。
    const order = state.orders.find(item => item.id === approval.orderId && item.tenantId === tenantId);
    if (order && order.status === 'draft') failOrderInternal(order, 'credit_approval_rejected', actor, input.comment ?? '授信超额审批被拒绝');
  }
  return clone(approval);
}

export function operationSummary(tenantId: string) { tenant(tenantId); const orders = listOrders(tenantId); const invoices = state.invoices.filter(item => item.tenantId === tenantId); const shipments = state.shipments.filter(item => item.tenantId === tenantId); return { tenantId, generatedAt: now(), orderCount: orders.length, byStatus: orders.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}), grossMerchandiseValue: money(orders.reduce((sum, item) => sum + item.totalAmount, 0)), receivable: money(invoices.reduce((sum, item) => sum + item.total - item.paid, 0)), paid: money(invoices.reduce((sum, item) => sum + item.paid, 0)), delayedShipments: shipments.filter(item => item.status === 'exception').length, pendingApprovals: state.approvals.filter(item => item.tenantId === tenantId && item.status === 'pending').length, backorderedOrders: orders.filter(item => item.status === 'backordered').length, inventory: state.inventory.filter(item => item.tenantId === tenantId).map(item => ({ warehouse: item.warehouse, sku: item.sku, available: item.available, reserved: item.reserved, free: item.available - item.reserved, version: item.version })), carrierLanes: state.carrierLanes.filter(item => item.tenantId === tenantId).map(item => ({ id: item.id, warehouse: item.warehouse, destination: item.destination, capacity: item.capacity, used: item.used, remaining: item.capacity - item.used, version: item.version })) }; }
export function timeline(tenantId: string, orderId: string) {
  const order = orderFor(tenantId, orderId);
  const relatedIds = new Set([order.id]);
  const shipment = state.shipments.find(item => item.orderId === orderId);
  const customs = state.customs.find(item => item.orderId === orderId);
  const invoice = state.invoices.find(item => item.orderId === orderId);
  if (shipment) relatedIds.add(shipment.id);
  if (customs) relatedIds.add(customs.id);
  if (invoice) relatedIds.add(invoice.id);
  state.approvals.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id));
  // 同一笔分配决策的候选方案、reservation 与订单事件共同构成时间线。
  state.allocationPlans.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id));
  state.reservations.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id));
  const direct = state.audit.filter(item => item.tenantId === tenantId && relatedIds.has(item.entityId));
  const linked = state.audit.filter(item => item.tenantId === tenantId && item.orderId === orderId && !relatedIds.has(item.entityId));
  return [...direct, ...linked].sort((a, b) => b.at.localeCompare(a.at)).map(clone);
}
export function listAudit(tenantId: string, limit = 100) { tenant(tenantId); return state.audit.filter(item => item.tenantId === tenantId).slice(0, Math.min(limit, 500)).map(clone); }
export function listOutbox(tenantId: string, status?: OutboxEvent['status']) { tenant(tenantId); return state.outbox.filter(item => item.tenantId === tenantId && (!status || item.status === status)).map(clone); }
export function publishOutbox(tenantId: string, eventId: string, actor = 'system') { const event = assertTenant(state.outbox.find(item => item.id === eventId) ?? (() => { throw new Error('事件不存在'); })(), tenantId); if (event.status === 'published') return clone(event); event.status = 'published'; event.attempts += 1; record(tenantId, actor, 'outbox.published', 'outbox', event.id, { status: 'pending' }, event, event.payload && typeof event.payload === 'object' && 'orderId' in event.payload ? String((event.payload as { orderId?: string }).orderId) : undefined); return clone(event); }


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
