const {Scraper} = require('bedetheque-scraper');
const parse = require('csv-parse');
const fs = require('fs')
const yargs = require('yargs');
const {hideBin} = require('yargs/helpers')
const mariadb = require('mariadb');

for (const envKey of ['MYSQL_COA_HOST', 'MYSQL_COA_DATABASE', 'MYSQL_DM_HOST', 'MYSQL_DM_DATABASE', 'MYSQL_PASSWORD']) {
  if (!process.env[envKey]) {
    console.error(`Environment variable not found, aborting: ${envKey}`)
    process.exit(1)
  }
}

const coaPool = mariadb.createPool({
  host: process.env.MYSQL_COA_HOST,
  user: 'root',
  port: 64000,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_COA_DATABASE
});

const dmPool = mariadb.createPool({
  host: process.env.MYSQL_DM_HOST,
  user: 'root',
  port: 64002,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DM_DATABASE
});

const args = yargs(hideBin(process.argv)).argv

const MAPPING_FILE = 'inducks_mapping.csv'
const ROOT_URL = 'https://www.bedetheque.com/';

const CONDITION_TO_ESTIMATION_PCT = {
  bon: 1,
  moyen: 0.7,
  mauvais: 0.3,
  indefini: 0.7,
  '': 0.7
}

const readCsvMapping = async (recordCallback) => {
  const parser = fs
    .createReadStream(MAPPING_FILE)
    .pipe(parse({
      columns: true
    }));
  for await (const record of parser) {
    recordCallback(record)
  }
}

async function run(coaConnection, dmConnection) {
  let mappedIssues = []
  const cacheDir = args['cache-dir'] || 'cache';
  fs.mkdirSync(cacheDir, {recursive: true})

  await readCsvMapping(record => mappedIssues.push(record))
  const seriesUrls = [...new Set(mappedIssues.map(({bedetheque_url}) => bedetheque_url))]
  const cachedCoaIssues = {}
  const cachedUserIssues = {}
  let estimationsPerUser = {}
  for (const serieUrl of seriesUrls) {
    const cacheFileName = `${cacheDir}/${serieUrl}.json`
    console.log(serieUrl)
    let scrapeOutput
    if (fs.existsSync(cacheFileName)) {
      console.log(' Data exists in cache')
      scrapeOutput = JSON.parse(fs.readFileSync(cacheFileName))
    } else {
      scrapeOutput = await Scraper.getSerie(ROOT_URL + serieUrl);
      fs.writeFileSync(cacheFileName, JSON.stringify(scrapeOutput))
    }
    const mappedIssuesForSeries = mappedIssues.filter(({bedetheque_url}) => bedetheque_url === serieUrl)
    for (const {bedetheque_num, bedetheque_title, publicationcode, issuenumber} of mappedIssuesForSeries) {
      cachedCoaIssues[publicationcode] = cachedCoaIssues[publicationcode]
        || (await coaConnection.query(
          "SELECT issuenumber FROM inducks_issue WHERE publicationcode=?",
          [publicationcode]
        )).map(({issuenumber}) => issuenumber)

      if (!cachedCoaIssues[publicationcode].length) {
        console.warn(` No issue found in COA for publication code ${publicationcode}`)
      } else if (!cachedCoaIssues[publicationcode].find(dbIssuenumber => dbIssuenumber === issuenumber)) {
        console.warn(` No issue found in COA for publication code ${publicationcode} and issue number ${issuenumber}`)
      } else {
        const bedethequeAlbum = scrapeOutput.albums.find(({albumNum, albumTitle}) =>
          !(
            (bedetheque_num !== '' && albumNum !== bedetheque_num) ||
            (bedetheque_title !== '' && albumTitle !== bedetheque_title)))
        if (!bedethequeAlbum) {
          console.warn(` No issue found in Bedetheque series "${serieUrl}": num=${bedetheque_num}, title=${bedetheque_title}`)
        } else {
          cachedUserIssues[publicationcode] = cachedUserIssues[publicationcode]
            || (await dmConnection.query(
              "SELECT ID_Utilisateur AS userId, Numero AS issuenumber, Etat AS 'condition' FROM numeros WHERE Pays=? AND Magazine=?",
              publicationcode.split('/')
            ))

          for (const userIssue of cachedUserIssues[publicationcode].filter(({issuenumber: userIssuenumber}) => userIssuenumber === issuenumber.replace(' ', ''))) {
            let condition = userIssue.condition || 'indefini';
            if (bedethequeAlbum.estimationEuros && bedethequeAlbum.estimationEuros.length) {
              let estimationMintCondition = bedethequeAlbum.estimationEuros[0];
              const estimationGivenCondition = estimationMintCondition * CONDITION_TO_ESTIMATION_PCT[condition]
              if (!estimationsPerUser[userIssue.userId]) {
                estimationsPerUser[userIssue.userId] = {total: 0, details: []}
              }
              estimationsPerUser[userIssue.userId].total += estimationGivenCondition
              estimationsPerUser[userIssue.userId].details.push({
                publicationcode,
                issuenumber,
                estimationGivenCondition
              })
              console.info(` User ${userIssue.userId} has issue ${issuenumber} with condition ${condition}`)
              console.log(` Estimation : + ${estimationGivenCondition}€`)
            }
          }
        }
      }
    }
    console.log('Done')
    for (let userId of Object.keys(estimationsPerUser)) {
      estimationsPerUser[userId].details = estimationsPerUser[userId].details.sort((a, b) => Math.sign(b .estimationGivenCondition - a.estimationGivenCondition))
    }
    fs.writeFileSync('output.json', JSON.stringify(estimationsPerUser))
  }
}

coaPool.getConnection()
  .then(async coaConnection => {
    dmPool.getConnection()
      .then(async dmConnection => {
        await run(coaConnection, dmConnection)
      }).catch(err => {
      console.error(err)
    });
  }).catch(err => {
  console.error(err)
});
