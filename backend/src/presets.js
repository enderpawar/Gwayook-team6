export const presets = [
  {
    id: 'toilet-paper',
    demo: true,
    product: {
      shortName: '3겹 롤휴지',
      fullTitle: '3겹 롤휴지 30m × 30롤',
      bulkTotalQty: 30,
      unitName: '롤',
      allocationStep: 1,
      uniformUnits: true,
      payment: {
        productAmount: 17701, shippingFee: 0, discountAmount: 0,
        includesShipping: false, includesDiscount: false, isEstimate: true,
      },
      comparisonSpec: { compatibilityKey: '시연용 3겹 롤휴지 (동일 폭)', unit: 'm', amountPerUnit: 30 },
      comparisonBaseline: {
        quantity: 12, unitName: '롤', price: 18900,
        spec: { compatibilityKey: '시연용 3겹 롤휴지 (동일 폭)', unit: 'm', amountPerUnit: 33 },
        source: { kind: 'SAMPLE', presetId: 'toilet-paper', label: '3겹 롤휴지 33m × 12롤 시연 가격' },
      },
    },
  },
  {
    id: 'bottled-water',
    demo: true,
    product: {
      shortName: '생수 2L',
      fullTitle: '생수 2L × 24병',
      bulkTotalQty: 24,
      unitName: '병',
      allocationStep: 1,
      uniformUnits: true,
      payment: {
        productAmount: 25920, shippingFee: 0, discountAmount: 0,
        includesShipping: false, includesDiscount: false, isEstimate: true,
      },
      comparisonSpec: { compatibilityKey: '시연용 생수', unit: 'L', amountPerUnit: 2 },
      comparisonBaseline: {
        quantity: 6, unitName: '병', price: 7800,
        spec: { compatibilityKey: '시연용 생수', unit: 'L', amountPerUnit: 2 },
        source: { kind: 'SAMPLE', presetId: 'bottled-water', label: '생수 2L × 6병 시연 가격' },
      },
    },
  },
  {
    id: 'fabric-softener',
    demo: true,
    product: {
      shortName: '섬유유연제 4L',
      fullTitle: '섬유유연제 4L',
      bulkTotalQty: 4000,
      unitName: 'ml',
      allocationStep: 100,
      uniformUnits: true,
      payment: {
        productAmount: 4980, shippingFee: 0, discountAmount: 0,
        includesShipping: false, includesDiscount: false, isEstimate: true,
      },
      comparisonSpec: { compatibilityKey: '시연용 섬유유연제 (동일 농축도)', unit: 'ml', amountPerUnit: 1 },
      comparisonBaseline: {
        quantity: 2300, unitName: 'ml', price: 3900,
        spec: { compatibilityKey: '시연용 섬유유연제 (동일 농축도)', unit: 'ml', amountPerUnit: 1 },
        source: { kind: 'SAMPLE', presetId: 'fabric-softener', label: '섬유유연제 2.3L 시연 가격' },
      },
    },
  },
];
