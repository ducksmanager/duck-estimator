import { Scraper } from 'bedetheque-scraper'

import { getScrapeCacheTime,syncScrapeCache } from '~/cache'
import { createQuotations, isInducksIssueExisting } from '~/coa'
import { readCsvMapping } from '~/csv'

const MAPPING_FILE = 'scrapes/bedetheque/coa-mapping.csv'
const ROOT_URL = 'https://www.bedetheque.com/'

type CsvIssue = {bedetheque_url: string, bedetheque_num: string, bedetheque_title: string, publicationcode: string, issuenumber: string}
const quotations: Parameters<typeof createQuotations>[0] = []

export async function scrape () {
  const mappedIssues: CsvIssue[] = []

  await readCsvMapping<CsvIssue>(MAPPING_FILE, record => mappedIssues.push(record))
  const seriesUrls = [...new Set(mappedIssues.map(({ bedetheque_url }) => bedetheque_url))]

  for (const serieUrl of seriesUrls) {
    const scrapeOutput = await syncScrapeCache<Awaited<ReturnType<typeof Scraper.getSerie>>>(
      'bedetheque',
      `${serieUrl}.json`,
      ROOT_URL + serieUrl,
      async (url) => await Scraper.getSerie(url),
      contents => JSON.parse(contents.toString()),
      contents => JSON.stringify(contents)
    )
    const mappedIssuesForSeries = mappedIssues.filter(({ bedetheque_url }) => bedetheque_url === serieUrl)
    for (const { bedetheque_num, bedetheque_title, publicationcode, issuenumber } of mappedIssuesForSeries) {
      if (await isInducksIssueExisting(publicationcode, issuenumber)) {
        const bedethequeAlbum = scrapeOutput!.albums.find(({ albumNum, albumTitle }) => !(
          (bedetheque_num !== '' && albumNum !== bedetheque_num) || (bedetheque_title !== '' && albumTitle !== bedetheque_title)))
        if (!bedethequeAlbum) {
          console.warn(` No issue found in Bedetheque series "${serieUrl}": num=${bedetheque_num}, title=${bedetheque_title}`)
        } else {
          let { estimationEuros } = bedethequeAlbum
          if (!estimationEuros) {
            estimationEuros = []
          }
          quotations.push({
            publicationcode,
            issuenumber,
            estimationMin: estimationEuros[0] || null,
            estimationMax: estimationEuros[1] || null,
            scrapeDate: getScrapeCacheTime('bedetheque', `${serieUrl}.json`),
            source: 'bedetheque'
          })
        }
      }
    }
    console.log('Done')
  }
  await createQuotations(quotations)
  console.log('Done for all')
}
