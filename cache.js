const fs = require('fs')
const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')

const args = yargs(hideBin(process.argv)).argv

const getCacheDir = () => args['cache-dir'] || 'cache'

module.exports = {
  getCacheDir,

  syncScrapeCache: async (scrapeDirName, fileName, url, fetchFn, postGetFromCacheTransformFn, preSetInCacheTransformFn) => {
    const cacheDirName = `${getCacheDir()}/${scrapeDirName}`
    const cacheFileName = `${cacheDirName}/${fileName}`
    let scrapeOutput
    if (fs.existsSync(cacheFileName)) {
      console.debug(' Data exists in cache')
      scrapeOutput = postGetFromCacheTransformFn(fs.readFileSync(cacheFileName))
    } else {
      if (!fs.existsSync(cacheDirName)) {
        fs.mkdirSync(cacheDirName, { recursive: true })
      }
      scrapeOutput = await fetchFn(url)
      fs.writeFileSync(cacheFileName, await preSetInCacheTransformFn(scrapeOutput))
    }
    return scrapeOutput
  },

  getScrapeCacheTime: (scrapeDirName, fileName) =>
    fs.statSync(`${getCacheDir()}/${scrapeDirName}/${fileName}`).mtime
}
