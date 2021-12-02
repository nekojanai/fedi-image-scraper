const https = require('https');
const fs = require('fs');

const RESULT_DIR_NAME = 'images';
const handlesToScrape = [];
let DELAY = 0;


if (process.argv.length <= 3) {
  console.log('no arguments received');
  console.log('usage:');
  console.log('node scraper.js <delay in seconds> <user1@sld.tld> <user2@sld.tld> ...')
  process.exit(1);
}

if (isNaN(process.argv[2])) {
  console.log('please specify seconds of delay between requests, if none desired please enter 0');
  console.log('usage:');
  console.log('node scraper.js <delay in seconds> <user1@sld.tld> <user2@sld.tld> ...')
  process.exit(1);
} 

console.log('awesome scraper 1.0');
console.log('The following fedi profiles will be hugged:');
process.argv.forEach((val, index, _) => {
  if (index === 2) {
    DELAY = val;
  }
  if (index >= 3 && /\S+@\S+\.\S+/.test(val)) {
    console.log(index-1 + ': ' + val);
    handlesToScrape.push(val);
  }
});

if(!fs.existsSync(RESULT_DIR_NAME)) {
  console.log('creating root dir: '+RESULT_DIR_NAME);
  fs.mkdirSync(RESULT_DIR_NAME);
}

handlesToScrape.forEach((handle, index, _) => {
  console.log('looking at '+handle);
  getProfileUrlFromWebfingerForHandle(handle, (profileUrl) => {
    // further execution in here because I like callback hell and can't be bothered to look up the Promise api
    getOutboxForActor(profileUrl, (outboxUrl) => {
      scrapeFirst(outboxUrl, handle);
    });
  });
});

function scrapeFirst(url, handle) {
  getData(url, (data) => {
    if (data.first) {
      if (!fs.existsSync(RESULT_DIR_NAME+'/'+handle)) {
        fs.mkdirSync(RESULT_DIR_NAME+'/'+handle);
      }
      startScrape(data.first, handle);
    } else {
      console.log('NOTHING HERE TO SCRAPE, THE KITSUNE\'s you\'re looking for are in another castle.');
    }
  });
}

function startScrape(url, handle) {
  getData(url, (data) => {
    if (data.next && data.next !== url) {
      scrapePage(data.next, handle, data.orderedItems);
    } else {
      console.log(handle+' fully scraped, yay!')
    }
  });
}

function scrapePage(nexturl, handle, activityCollection) {
  if (activityCollection.length > 0) {
    const activity = activityCollection[0];
    if (activity.type === 'Create' && activity.object.attachment.length > 0) {
      scrapeAttachment(nexturl, handle, activityCollection, activity.object.attachment);
    }
  } else {
    console.log('page done - no more activities - NEXT');
    startScrape(nexturl, handle);
  }
}

function scrapeAttachment(nextPageUrl, handle, activityCollection, attachments) {
  if (attachments.length > 0) {
    const attachment = attachments[0];
    const fullpath = RESULT_DIR_NAME+'/'+handle+'/'+attachment.name;
    download(attachment.url, fullpath, () => {
      console.log('√ DL complete: '+attachment.url);
      if (DELAY > 0) {
        setTimeout(() => {
          attachments.shift();
          scrapeAttachment(nextPageUrl, handle, activityCollection, attachments);
        }, DELAY*1000);
      } else {
        attachments.shift();
        scrapeAttachment(nextPageUrl, handle, activityCollection, attachments);
      }
    });
  } else {
    console.log('activity done - no more attachments - NEXT');
    activityCollection.shift();
    scrapePage(nextPageUrl, handle, activityCollection);
  }
}

function download(urlsrc, fsdest, callback) {
  const file = fs.createWriteStream(fsdest);
  const request = https.get(urlsrc, (response) => {
    if (response.statusCode !== 200 && response.statusCode !== 301) {
      console.log('received unprocessable httpStatus: '+response.statusCode+' '+response.statusMessage);
    } else if (response.statusCode === 301 || response.statusCode === 302) {
      fs.unlink(fsdest, (err) => {
        if (!err) {
          download(response.headers.location, fsdest, callback);
        } else {
          console.log(err);
        }
      });
    } else {
      console.log('downloading '+urlsrc);
      response.pipe(file);
    }
  });
  file.on('finish', () => file.close(callback));
  file.on('error', (err) => {
    fs.unlink(fsdest);
    cb(err.message);
  });
  request.on('error', (err) => {
    fs.unlink(fsdest);
    cb(err.message);
  });
}

function getOutboxForActor(url, callback) {
  getData(url, (actor) => {
    callback(actor.outbox);
  });
}

function getProfileUrlFromWebfingerForHandle(handle, callback) {
  console.log('webfingering '+handle);
  const webfingerUrl = constructWebfingerUrl(handle);
  if (typeof webfingerUrl === 'string') {
    getData(webfingerUrl, (webfinger) => {
      webfinger.links.forEach((linkObj) => {
        if(linkObj.type === "application/activity+json") {
          callback(linkObj.href);
        }
      });
    });
  }
}

function constructWebfingerUrl(handle) {
  const split = handle.split('@');
  if (split.length !== 2) {
    throw new Error(handle+' has wrong format, make sure it\'s username@domain');
  }
  const [username, domain] = split;
  if (!username || !domain) {
    throw new Error(handle+' has wrong format, make sure it\'s username@domain');
  }
  return `https://${domain}/.well-known/webfinger?resource=acct:${handle}`;
}

function getData(url, callback) {
  https.get(url, {headers: {
    'Accept': 'application/json'
  }}, (resp) => {
    let data = '';
    resp.on('data', (chunk) => {
      data += chunk;
    });
    resp.on('end', () => {
      callback(JSON.parse(data));
    });
  });
}
