const { createQuotations, getInducksIssuesBetween} = require('../../coa')
const {readCsvMapping } = require('../../csv')
const {firefox} = require("playwright-firefox");

const MAPPING_FILE = 'scrapes/seriesam/coa-mapping.csv'
const ROOT_URL = 'https://www.seriesam.com/cgi-bin/guide?s='
const quotations = []

module.exports = {
  async scrape() {
    const mappedIssues = []

    await readCsvMapping(MAPPING_FILE, record => mappedIssues.push(record))
    const seriesUrls = [...new Set(mappedIssues.map(({seriesamQuery}) => seriesamQuery))]

    const browser = await firefox.launch()
    const page = await browser.newPage()

    let mappedIssueRowNumber = 0

    for (const serieUrl of seriesUrls) {
      const url = ROOT_URL + serieUrl
      console.info(`Scraping ${url}...`)
      await page.goto(url)
      const rows = await page.$$('.guidetable tr')

      let seriesamYear
      for (const row of rows) {
        const {
          seriesamYear: seriesamYearMapping,
          seriesamTitle: seriesamTitleMapping,
          publicationcode,
          issuenumber
        } = mappedIssues[mappedIssueRowNumber];
        const seriesamYearCell = await row.$('td:nth-child(1)');
        const seriesamTitleCell = await row.$('td:nth-child(2)');
        if (!seriesamYearCell || !seriesamTitleCell) {
          continue
        }
        if ((await seriesamYearCell.innerText()).includes('Seriesams Guide')) {
          continue
        }
        const seriesamYearCurrent = (await (await seriesamYearCell.innerText())).trimLeft()
        const seriesamTitle = (await (await seriesamTitleCell.innerText())).trimLeft()
        if (seriesamYearCurrent) {
          seriesamYear = seriesamYearCurrent
        }
        const issuenumbers = await getInducksIssuesBetween(publicationcode, ...issuenumber.split(' to '))
        let hasFoundQuotation = false
        for (const issuenumberInRange of issuenumbers) {
          if (seriesamYear === seriesamYearMapping || seriesamTitle === seriesamTitleMapping) {
            let cellNumber = 5
            let column
            while (true) {
              column = await row.$(`td:nth-child(${cellNumber})`)
              if (column === null) {
                console.warn(` Inducks issue ${publicationcode} ${issuenumberInRange}: No quotation found`)
                break
              } else {
                const estimation = parseInt(await column.innerText())
                if (isNaN(estimation)) {
                  cellNumber++
                } else {
                  console.info(` Inducks issue ${publicationcode} ${issuenumberInRange}: A quotation was found`)
                  const adjustedEstimation = estimation * Math.pow(0.8, cellNumber - 5)
                  quotations.push({
                    publicationcode,
                    issuenumberInRange,
                    estimationMin: adjustedEstimation,
                    estimationMax: adjustedEstimation,
                    scrapeDate: null,
                    source: 'seriesam'
                  })
                  hasFoundQuotation = true
                  break
                }
              }
            }
          }
        }
        if (hasFoundQuotation) {
          mappedIssueRowNumber++
        }
      }
      console.log('Done')
    }
    await createQuotations(quotations)
    console.log('Done for all')
  }
}