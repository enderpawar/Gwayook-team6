const units = new Set(['롤', '병', '개', 'ml', 'g']);
const defaultLocation = '행복기숙사 1동 로비';
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

const productFields = {
  shortName: (value) => text(value, 80),
  fullTitle: (value) => text(value, 200),
  bulkTotalPrice: positiveInteger,
  bulkTotalQty: positiveInteger,
  unitName: (value) => units.has(value) ? value : undefined,
  smallPackQty: positiveInteger,
  smallPackPrice: positiveInteger,
};

export function validateProduct(input) {
  const product = {};
  const fields = [];
  for (const [name, validate] of Object.entries(productFields)) {
    const value = validate(input?.[name]);
    if (value === undefined) fields.push(name);
    else product[name] = value;
  }

  const annualPurchaseCount = input?.annualPurchaseCount === undefined
    ? 12
    : positiveInteger(input.annualPurchaseCount);
  if (annualPurchaseCount === undefined) fields.push('annualPurchaseCount');
  else product.annualPurchaseCount = annualPurchaseCount;

  const whyGood = text(input?.whyGood, 200);
  if (whyGood !== undefined) product.whyGood = whyGood;
  return { product, fields };
}

export function validateOptions(input) {
  const people = input?.people;
  const fields = [];
  if (!Number.isInteger(people) || people < 2 || people > 4) fields.push('people');
  const rawLocation = input?.location;
  const location = rawLocation === undefined || (typeof rawLocation === 'string' && !rawLocation.trim())
    ? defaultLocation
    : text(rawLocation, 100);
  if (location === undefined) fields.push('location');
  return { people, location, fields };
}

export function analyze(product, people, location) {
  const { bulkTotalQty, bulkTotalPrice, smallPackQty, smallPackPrice, unitName, annualPurchaseCount } = product;
  const baseQuantity = Math.floor(bulkTotalQty / people);
  const baseAmount = Math.floor(bulkTotalPrice / people);
  const organizerQuantity = baseQuantity + bulkTotalQty % people;
  const organizerAmount = baseAmount + bulkTotalPrice % people;
  const settlements = Array.from({ length: people }, (_, index) => ({
    member: index + 1,
    role: index === 0 ? 'ORGANIZER' : 'MEMBER',
    quantity: index === 0 ? organizerQuantity : baseQuantity,
    amount: index === 0 ? organizerAmount : baseAmount,
  }));

  const bulkUnitPrice = bulkTotalPrice / bulkTotalQty;
  const smallUnitPrice = smallPackPrice / smallPackQty;
  const discountPercent = ((smallUnitPrice - bulkUnitPrice) / smallUnitPrice) * 100;
  const instantSavings = organizerQuantity * smallUnitPrice - organizerAmount;
  const displayUnitQuantity = unitName === 'ml' || unitName === 'g' ? 100 : 1;
  const comparison = {
    displayUnitQuantity,
    bulkUnitPrice: bulkUnitPrice * displayUnitQuantity,
    smallUnitPrice: smallUnitPrice * displayUnitQuantity,
    discountPercent,
    instantSavings,
    annualSavings: instantSavings * annualPurchaseCount,
  };

  const title = `[공구] ${product.shortName} 같이 살 ${people - 1}명 구해요`;
  const discount = discountPercent > 0
    ? `소용량 대비 단가가 ${percentFormat.format(discountPercent)}% 낮아요.`
    : discountPercent < 0
      ? `소용량 대비 단가가 ${percentFormat.format(-discountPercent)}% 높아요.`
      : '소용량과 단가가 같아요.';
  const body = [
    `${product.fullTitle} 공동구매할 분을 찾고 있어요!`,
    `모집: ${people - 1}자리`,
    `공구원 1명당 ${integerFormat.format(baseQuantity)}${unitName} · ${integerFormat.format(baseAmount)}원`,
    discount,
    `수령 장소: ${location}`,
    '함께하실 분은 댓글이나 쪽지 부탁드려요!',
  ].join('\n');

  return { product, people, location, comparison, settlements, recruitment: { title, body } };
}
