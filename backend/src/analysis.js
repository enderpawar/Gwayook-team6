import { presets } from './presets.js';

const units = new Set(['롤', '병', '개', 'ml', 'g']);
const comparisonUnits = new Map([
  ['ml', ['ml', 1]], ['L', ['ml', 1000]],
  ['m', ['m', 1000]], ['cm', ['m', 10]],
  ['g', ['g', 1]], ['kg', ['g', 1000]],
  ['개', ['개', 1]],
]);
const integerFormat = new Intl.NumberFormat('ko-KR');
const percentFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });

function text(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

const paymentFields = {
  productAmount: nonnegativeInteger,
  shippingFee: nonnegativeInteger,
  discountAmount: nonnegativeInteger,
  includesShipping: boolean,
  includesDiscount: boolean,
};

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function boolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

export function validateProduct(input) {
  const fields = [];
  const product = {};
  const payment = {};
  function read(target, key, value, field = `product.${key}`) {
    if (value === undefined) fields.push(field);
    else target[key] = value;
  }

  read(product, 'shortName', text(input?.shortName, 80));
  read(product, 'fullTitle', text(input?.fullTitle, 200));
  read(product, 'bulkTotalQty', positiveInteger(input?.bulkTotalQty));
  read(product, 'unitName', units.has(input?.unitName) ? input.unitName : undefined);
  read(product, 'allocationStep', positiveInteger(input?.allocationStep));
  read(product, 'uniformUnits', input?.uniformUnits === true ? true : undefined);
  if (product.bulkTotalQty !== undefined && product.allocationStep !== undefined
    && product.bulkTotalQty % product.allocationStep !== 0) fields.push('product.allocationStep');

  for (const [key, validate] of Object.entries(paymentFields)) {
    read(payment, key, validate(input?.payment?.[key]), `product.payment.${key}`);
  }
  read(payment, 'isEstimate', input?.payment?.isEstimate === undefined
    ? true : boolean(input.payment.isEstimate), 'product.payment.isEstimate');

  if (Object.keys(paymentFields).every((key) => payment[key] !== undefined)) {
    const total = BigInt(payment.productAmount)
      + BigInt(payment.includesShipping ? 0 : payment.shippingFee)
      - BigInt(payment.includesDiscount ? 0 : payment.discountAmount);
    if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) fields.push('product.payment');
    else payment.totalAmount = Number(total);
  }
  product.payment = payment;

  if (input?.annualPurchaseCount != null) {
    read(product, 'annualPurchaseCount', positiveInteger(input.annualPurchaseCount));
  }
  return { product, fields };
}

export function validateOptions(input) {
  const people = input?.people;
  const fields = [];
  if (!Number.isInteger(people) || people < 2 || people > 4) fields.push('people');

  function optionalText(key, maxLength, fallback) {
    const value = input?.[key];
    if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
    const normalized = text(value, maxLength);
    if (normalized === undefined) fields.push(key);
    return normalized;
  }

  return {
    people,
    location: optionalText('location', 100, null),
    deadline: optionalText('deadline', 100, null),
    applicationMethod: optionalText('applicationMethod', 150, '댓글 또는 쪽지'),
    fields,
  };
}

function normalizeSpec(input, unitName, quantity) {
  const compatibilityKey = text(input?.compatibilityKey, 100);
  const conversion = comparisonUnits.get(input?.unit);
  if (!compatibilityKey || !conversion || typeof input.amountPerUnit !== 'number') return null;
  const [unit, factor] = conversion;
  const perUnit = positiveInteger(Math.round(input.amountPerUnit * factor));
  if (!perUnit || perUnit / factor !== input.amountPerUnit || !positiveInteger(perUnit * quantity)) return null;
  // Volume/mass allocation counts the base unit itself. Roll and bottle counts
  // alone never establish the size of their contents.
  if ((unitName === 'ml' || unitName === 'g') && (unitName !== unit || perUnit !== 1)) return null;
  if (unitName === '롤' && unit !== 'm') return null;
  if (unitName === '병' && unit !== 'ml') return null;
  if (unit === '개' && (unitName !== '개' || perUnit !== 1)) return null;
  return {
    unit, perUnit, compatibilityKey,
    spec: { compatibilityKey, unit, amountPerUnit: perUnit / (unit === 'm' ? 1000 : 1) },
  };
}

function userSource(input) {
  if (input?.kind !== 'USER_INPUT') return null;
  const source = { kind: 'USER_INPUT' };
  if (input.reference != null) {
    const { kind, value } = input.reference;
    const reference = text(value, 1000);
    if (!reference || (kind !== 'LINK' && kind !== 'SCREENSHOT')) return null;
    if (kind === 'LINK' && !['http:', 'https:'].includes(URL.parse(reference)?.protocol)) return null;
    source.reference = { kind, value: reference };
  }
  const checkedOn = input.checkedOn;
  if (typeof checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) {
    const date = new Date(checkedOn);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === checkedOn) source.checkedOn = checkedOn;
  }
  return source;
}

function compare(product, rawProduct, settlements) {
  const pending = (reason) => ({ status: 'PENDING', reason });
  const bulk = normalizeSpec(rawProduct.comparisonSpec, product.unitName, product.bulkTotalQty);
  if (bulk) product.comparisonSpec = bulk.spec;

  const baseline = rawProduct.comparisonBaseline;
  const price = positiveInteger(baseline?.price);
  if (!price) return pending('MISSING_BASELINE_PRICE');
  const quantity = positiveInteger(baseline.quantity);
  const unitName = baseline.unitName;
  const small = quantity && units.has(unitName) ? normalizeSpec(baseline.spec, unitName, quantity) : null;
  if (!bulk || !small) return pending('UNCONFIRMED_SPEC');
  if (bulk.unit !== small.unit || bulk.compatibilityKey !== small.compatibilityKey) {
    return pending('INCOMPATIBLE_SPEC');
  }

  let source;
  if (baseline.source?.kind === 'SAMPLE') {
    const preset = presets.find(({ id }) => id === baseline.source.presetId)?.product;
    const sample = preset?.comparisonBaseline;
    const sampleBulk = preset && normalizeSpec(preset.comparisonSpec, preset.unitName, preset.bulkTotalQty);
    const sampleSmall = sample && normalizeSpec(sample.spec, sample.unitName, sample.quantity);
    if (!sampleBulk || product.unitName !== preset.unitName
      || bulk.compatibilityKey !== sampleBulk.compatibilityKey || bulk.unit !== sampleBulk.unit
      || bulk.perUnit !== sampleBulk.perUnit || unitName !== sample.unitName
      || small.perUnit !== sampleSmall.perUnit || quantity !== sample.quantity || price !== sample.price) {
      return pending('SAMPLE_MISMATCH');
    }
    source = sample.source;
  } else {
    source = userSource(baseline.source);
    if (!source) return pending('UNCONFIRMED_SOURCE');
  }
  product.comparisonBaseline = { price, quantity, unitName, spec: small.spec, source };

  const displayUnitQuantity = bulk.unit === 'ml' || bulk.unit === 'g' ? 100 : 1;
  const displayFactor = bulk.unit === 'm' ? 1000 : displayUnitQuantity;
  const bulkTotal = BigInt(product.bulkTotalQty * bulk.perUnit);
  const smallTotal = BigInt(quantity * small.perUnit);
  const bulkPrice = BigInt(product.payment.totalAmount);
  const smallPrice = BigInt(price);
  const bulkUnitPrice = ratio(bulkPrice * BigInt(displayFactor), bulkTotal);
  const smallUnitPrice = ratio(smallPrice * BigInt(displayFactor), smallTotal);
  const smallComparable = smallPrice * bulkTotal;
  const discountPercent = ratio((smallComparable - bulkPrice * smallTotal) * 100n, smallComparable);
  for (const settlement of settlements) {
    const share = BigInt(settlement.quantity * bulk.perUnit);
    const savings = share * smallPrice - BigInt(settlement.amount) * smallTotal;
    settlement.instantSavings = ratio(savings, smallTotal);
    if (product.annualPurchaseCount !== undefined) {
      settlement.annualSavings = ratio(savings * BigInt(product.annualPurchaseCount), smallTotal);
    }
  }
  return { status: 'READY', source, displayUnit: bulk.unit, displayUnitQuantity, bulkUnitPrice, smallUnitPrice, discountPercent };
}

function ratio(numerator, denominator) {
  return Number(numerator / denominator) + Number(numerator % denominator) / Number(denominator);
}

function settle(product, people) {
  const { bulkTotalQty, allocationStep, payment } = product;
  const units = bulkTotalQty / allocationStep;
  const extra = units % people;
  const base = (units - extra) / people;
  const totalQty = BigInt(bulkTotalQty);
  const totalAmount = BigInt(payment.totalAmount);
  let unassigned = payment.totalAmount;
  const priority = [];
  const settlements = Array.from({ length: people }, (_, index) => {
    const quantity = (base + (index === 0 ? extra : 0)) * allocationStep;
    const numerator = totalAmount * BigInt(quantity);
    const amount = Number(numerator / totalQty);
    unassigned -= amount;
    priority.push({ index, remainder: Number(numerator % totalQty) });
    return { member: index + 1, role: index === 0 ? 'ORGANIZER' : 'MEMBER', quantity, amount };
  });
  priority.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < unassigned; index++) settlements[priority[index].index].amount++;
  return settlements;
}

function recruit(product, { people, location, deadline, applicationMethod }, comparison, settlements) {
  const title = `[공구] ${product.shortName} 같이 살 ${people - 1}명 구해요`;
  const estimate = product.payment.isEstimate ? '예상 ' : '';
  const share = ({ quantity, amount }) => `${integerFormat.format(quantity)}${product.unitName} · ${estimate}${integerFormat.format(amount)}원`;
  const lines = [
    `${product.fullTitle} 공동구매할 분을 찾고 있어요!`,
    `모집: ${people - 1}자리`,
    `방장: ${share(settlements[0])}`,
  ];
  const first = settlements[1];
  if (settlements.every((row, index) => index === 0 || row.amount === first.amount)) {
    lines.push(`공구원 1명당 ${share(first)}`);
  } else {
    for (let index = 1; index < people; index++) {
      lines.push(`공구원 ${index}: ${share(settlements[index])}`);
    }
  }
  if (comparison.status === 'READY' && comparison.source.kind === 'USER_INPUT') {
    const percent = comparison.discountPercent;
    const difference = percentFormat.format(Math.abs(percent));
    const statement = percent === 0 ? '소용량과 단가가 같아요.'
      : `소용량 대비 단가가 ${difference}% ${percent > 0 ? '낮아요' : '높아요'}.`;
    lines.push(product.payment.isEstimate ? `예상 비교: ${statement}` : statement);
  }
  lines.push(`수령 장소: ${location ?? '미정'}`, `신청 마감: ${deadline ?? '미정'}`, `신청 방법: ${applicationMethod}`);
  return { title, body: lines.join('\n') };
}

export function analyze(product, rawProduct, { people, location, deadline, applicationMethod }) {
  const settlements = settle(product, people);
  const comparison = compare(product, rawProduct, settlements);
  const recruitment = recruit(product, { people, location, deadline, applicationMethod }, comparison, settlements);
  return { product, people, location, deadline, applicationMethod, comparison, settlements, recruitment };
}
