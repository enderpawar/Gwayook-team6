import type { Plugin } from 'vite'

const price = (amount: number, kind: string, condition: string | null) => ({
  amount,
  kind,
  condition,
  evidence: `${amount.toLocaleString('ko-KR')}원`,
})

const base = {
  fullTitle: '모의 응답 키친타월 150매 12롤',
  shortName: '키친타월 12롤',
  selectedOption: '150매 x 12롤',
  packCount: 2,
  unitsPerPack: 6,
  netAmountPerUnit: null,
  unitName: '롤',
  displayedTotalPrice: 15900,
  shippingFee: null,
  discountAmount: 0,
  optionCandidates: [],
  priceCandidates: [],
  evidence: {},
  unresolvedFields: ['shippingFee'],
}

/**
 * 백엔드가 준비되기 전 개발용 모의 응답. `npm run dev:mock` 에서만 켜진다.
 * 파일 이름으로 상황을 고른다: multi(가격·옵션 후보 여러 개), bad(잘못된 JSON), timeout, 503
 */
export function mockExtraction(): Plugin {
  return {
    name: 'mock-extraction',
    configureServer(server) {
      server.middlewares.use('/api/products/extract', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const head = Buffer.concat(chunks).subarray(0, 600).toString('utf8')
          const name = /filename="([^"]*)"/.exec(head)?.[1] ?? ''
          if (name.includes('timeout')) return
          if (name.includes('503')) {
            res.statusCode = 503
            res.end()
            return
          }
          const body = name.includes('bad')
            ? '{"fullTitle": '
            : JSON.stringify(
                name.includes('multi')
                  ? {
                      ...base,
                      selectedOption: null,
                      optionCandidates: ['150매 x 12롤', '200매 x 12롤'],
                      displayedTotalPrice: null,
                      priceCandidates: [price(15900, '판매가', null), price(13900, '쿠폰 적용가', '첫 구매 쿠폰')],
                    }
                  : base,
              )
          setTimeout(() => {
            res.setHeader('content-type', 'application/json')
            res.end(body)
          }, 1800)
        })
      })
    },
  }
}
