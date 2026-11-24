export const presets = [
  {
    id: 'toilet-paper',
    product: {
      shortName: '3겹 롤휴지',
      fullTitle: '크리넥스 3겹 순수소프트 쿠션 내추럴 30m × 30롤',
      bulkTotalPrice: 19900,
      bulkTotalQty: 30,
      unitName: '롤',
      smallPackQty: 12,
      smallPackPrice: 18900,
      annualPurchaseCount: 12,
      whyGood: '보관 부담이 큰 30롤 묶음을 나눠 가져요.',
    },
    sources: {
      bulk: { url: 'https://emart.ssg.com/search.ssg?query=%EB%91%90%EB%A3%A8%EB%A7%88%EB%A6%AC%ED%9C%B4%EC%A7%80' },
      small: {
        label: '바스틀리 3겹 토일렛롤 33m × 12롤',
        url: 'https://emart.ssg.com/search.ssg?query=%ED%81%AC%EB%A6%AC%EB%84%A5%EC%8A%A4%ED%99%94%EC%9E%A5%EC%A7%80',
      },
    },
  },
  {
    id: 'bottled-water',
    product: {
      shortName: '생수 2L',
      fullTitle: '제주 삼다수 그린 2L × 24병',
      bulkTotalPrice: 25920,
      bulkTotalQty: 24,
      unitName: '병',
      smallPackQty: 6,
      smallPackPrice: 7800,
      annualPurchaseCount: 12,
      whyGood: '무거운 2L 생수를 필요한 만큼 나눠요.',
    },
    sources: {
      bulk: { url: 'https://emart.ssg.com/disp/category.ssg?dispCtgId=6000213425' },
      small: {
        label: '제주 삼다수 그린 2L × 6병',
        url: 'https://m.gsshop.com/section/brandSect/57633?lCate=1660610&mCate=1661018&mseq=406615',
      },
    },
  },
  {
    id: 'fabric-softener',
    product: {
      shortName: '섬유유연제 4L',
      fullTitle: '노브랜드 섬유유연제 쁘띠 코튼케이크향 4L',
      bulkTotalPrice: 4980,
      bulkTotalQty: 4000,
      unitName: 'ml',
      smallPackQty: 2300,
      smallPackPrice: 3900,
      annualPurchaseCount: 12,
      whyGood: '부피가 큰 4L 섬유유연제를 필요한 용량만큼 소분해요.',
    },
    sources: {
      bulk: { url: 'https://www.ssg.com/item/itemView.ssg?itemId=1000548315779' },
      small: {
        label: '피죤 블루비앙카 2300ml',
        url: 'https://emart.ssg.com/disp/category.ssg?dispCtgId=6000214424',
      },
    },
  },
];
