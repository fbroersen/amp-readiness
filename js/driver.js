/**
 * WebExtension driver
 */

/* eslint-env browser */
/* global browser, chrome, fetch, Wappalyzer */

/** global: browser */
/** global: chrome */
/** global: fetch */
/** global: Wappalyzer */

const wappalyzer = new Wappalyzer();

const tabCache = {};
let categoryOrder = [];
const options = {};
const robotsTxtQueue = {};

browser.tabs.onRemoved.addListener((tabId) => {
  tabCache[tabId] = null;
});

/**
 * Get a value from localStorage
 */
function getOption(name, defaultValue = null) {
  return new Promise((resolve, reject) => {
    const callback = (item) => {
      options[name] = item[name] ? item[name] : defaultValue;

      resolve(options[name]);
    };

    browser.storage.local.get(name)
      .then(callback)
      .catch((error) => {
        wappalyzer.log(error, 'driver', 'error');

        reject();
      });
  });
}

/**
 * Set a value in localStorage
 */
function setOption(name, value) {
  const option = {};

  option[name] = value;

  browser.storage.local.set(option);

  options[name] = value;
}

/**
 * Open a tab
 */
function openTab(args) {
  browser.tabs.create({
    url: args.url,
    active: args.background === undefined || !args.background,
  });
}

/**
 * Make a POST request
 */
function post(url, body) {
  fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  })
    .then(response => wappalyzer.log(`POST ${url}: ${response.status}`, 'driver'))
    .catch(error => wappalyzer.log(`POST ${url}: ${error}`, 'driver', 'error'));
}

// Prod config
// fetch('https://raw.githubusercontent.com/philkrie/ampbench/master/readiness-tool/apps.json')
//   .then(response => response.json())
//   .then((json) => {
//     wappalyzer.apps = json.apps;
//     wappalyzer.categories = json.categories;
    
//     fetch('https://raw.githubusercontent.com/philkrie/ampbench/master/readiness-tool/extended_apps.json')
//       .then(response_ext => response_ext.json())
//       .then((json_ext) => {
// Prod config

// Testing config
fetch('../apps.json')
  .then(response => response.json())
  .then((json) => {
    wappalyzer.apps = json.apps;
    wappalyzer.categories = json.categories;
    
    fetch('../extended_apps.json')
      .then(response_ext => response_ext.json())
      .then((json_ext) => {
// Testing config

        wappalyzer.apps = Object.assign({}, wappalyzer.apps, json_ext.apps);

        wappalyzer.parseJsPatterns();

        categoryOrder = Object.keys(wappalyzer.categories)
          .map(categoryId => parseInt(categoryId, 10))
          .sort((a, b) => wappalyzer.categories[a].priority - wappalyzer.categories[b].priority);

        wappalyzer.supported_apps = json_ext.supported;
        wappalyzer.incompatible_apps = json_ext.incompatible;
        wappalyzer.conv_cat_tooltips = json_ext.conversionCategoryTooltips;
        wappalyzer.incom_cat_tooltips = json_ext.incompatibleCategoryTooltips;
        wappalyzer.tech_tooltips = json_ext.technologyTooltips;        
    })
    .catch(error => wappalyzer.log(`GET extended_apps.json: ${error}`, 'driver', 'error'));
  })
  .catch(error => wappalyzer.log(`GET apps.json: ${error}`, 'driver', 'error'));

// Version check
const { version } = browser.runtime.getManifest();

getOption('version')
  .then((previousVersion) => {
    if (previousVersion === null) {
      
    } else if (version !== previousVersion) {
      getOption('upgradeMessage', true)
        .then((upgradeMessage) => {
          if (upgradeMessage) {
           
          }
        });
    }

    setOption('version', version);
  });

getOption('dynamicIcon', false);


getOption('hostnameCache', {})
  .then((hostnameCache) => {
    wappalyzer.hostnameCache = hostnameCache;

    return hostnameCache;
  });

// Run content script on all tabs
browser.tabs.query({ url: ['http://*/*', 'https://*/*'] })
  .then((tabs) => {
    tabs.forEach((tab) => {
      browser.tabs.executeScript(tab.id, {
        file: '../js/content.js',
      });
    });
  })
  .catch(error => wappalyzer.log(error, 'driver', 'error'));

// Capture response headers
browser.webRequest.onCompleted.addListener((request) => {
  const headers = {};

  if (request.responseHeaders) {
    const url = wappalyzer.parseUrl(request.url);

    browser.tabs.query({ url: [url.href] })
      .then((tabs) => {
        const tab = tabs[0] || null;

        if (tab) {
          request.responseHeaders.forEach((header) => {
            const name = header.name.toLowerCase();

            headers[name] = headers[name] || [];

            headers[name].push((header.value || header.binaryValue || '').toString());
          });

          if (headers['content-type'] && /\/x?html/.test(headers['content-type'][0])) {
            wappalyzer.analyze(url, { headers }, { tab });
          }
        }
      })
      .catch(error => wappalyzer.log(error, 'driver', 'error'));
  }
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['responseHeaders']);

// Listen for messages
(chrome || browser).runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message.id !== 'undefined') {
    if (message.id !== 'log') {
      wappalyzer.log(`Message${message.source ? ` from ${message.source}` : ''}: ${message.id}`, 'driver');
    }

    const url = wappalyzer.parseUrl(sender.tab ? sender.tab.url : '');
    let response;

    switch (message.id) {
      case 'log':
        wappalyzer.log(message.subject, message.source);

        break;
      case 'init':
        browser.cookies.getAll({ domain: `.${url.hostname}` })
          .then(cookies => wappalyzer.analyze(url, { cookies }, { tab: sender.tab }));

        break;
      case 'analyze':
        wappalyzer.analyze(url, message.subject, { tab: sender.tab });

        setOption('hostnameCache', wappalyzer.hostnameCache);

        break;
      case 'ad_log':
        wappalyzer.cacheDetectedAds(message.subject);

        break;
      case 'get_apps':
        response = {
          tabCache: tabCache[message.tab.id],
          apps: wappalyzer.apps,
          categories: wappalyzer.categories,
          pinnedCategory: options.pinnedCategory,
          supported_apps: wappalyzer.supported_apps,
          incompatible_apps: wappalyzer.incompatible_apps,
          conv_cat_tooltips: wappalyzer.conv_cat_tooltips,
          incom_cat_tooltips: wappalyzer.incom_cat_tooltips,
          tech_tooltips: wappalyzer.tech_tooltips
        };

        break;

      case 'set_option':
        setOption(message.key, message.value);

        break;
      case 'get_js_patterns':
        response = {
          patterns: wappalyzer.jsPatterns,
        };

        break;
      default:
    }

    sendResponse(response);
  }

  return true;
});

wappalyzer.driver.document = document;

/**
 * Log messages to console
 */
wappalyzer.driver.log = (message, source, type) => {
  console.log(`[wappalyzer ${type}]`, `[${source}]`, message);
};

/**
 * Display apps
 */
wappalyzer.driver.displayApps = (detected, meta, context) => {
  const { tab } = context;

  if (tab === undefined) {
    return;
  }

  tabCache[tab.id] = tabCache[tab.id] || {
    detected: [],
  };

  tabCache[tab.id].detected = detected;

  let found = false;

  // Find the main application to display
  [options.pinnedCategory].concat(categoryOrder).forEach((match) => {
    Object.keys(detected).forEach((appName) => {
      const app = detected[appName];

      app.props.cats.forEach((category) => {
        if (category === match && !found) {
          let icon = app.props.icon || 'default.svg';

          if (!options.dynamicIcon) {
            icon = 'default.svg';
          }

          if (/\.svg$/i.test(icon)) {
            icon = `converted/${icon.replace(/\.svg$/, '.png')}`;
          }

          try {
            browser.pageAction.setIcon({
              tabId: tab.id,
              path: `../images/icons/${icon}`,
            });
          } catch (e) {
            // Firefox for Android does not support setIcon see https://bugzilla.mozilla.org/show_bug.cgi?id=1331746
          }

          found = true;
        }
      });
    });
  });

  if (typeof chrome !== 'undefined') {
    // Browser polyfill doesn't seem to work here
    chrome.pageAction.show(tab.id);
  } else {
    browser.pageAction.show(tab.id);
  }
};

/**
 * Fetch and cache robots.txt for host
 */
wappalyzer.driver.getRobotsTxt = (host, secure = false) => {
  if (robotsTxtQueue[host]) {
    return robotsTxtQueue[host];
  }

  robotsTxtQueue[host] = new Promise((resolve) => {
    getOption('tracking', true)
      .then((tracking) => {
        if (!tracking) {
          resolve([]);

          return;
        }

        getOption('robotsTxtCache')
          .then((robotsTxtCache) => {
            robotsTxtCache = robotsTxtCache || {};

            if (host in robotsTxtCache) {
              resolve(robotsTxtCache[host]);

              return;
            }

            const timeout = setTimeout(() => resolve([]), 3000);

            fetch(`http${secure ? 's' : ''}://${host}/robots.txt`, { redirect: 'follow' })
              .then((response) => {
                clearTimeout(timeout);

                return response.ok ? response.text() : '';
              })
              .then((robotsTxt) => {
                robotsTxtCache[host] = Wappalyzer.parseRobotsTxt(robotsTxt);

                setOption('robotsTxtCache', robotsTxtCache);

                resolve(robotsTxtCache[host]);
              })
              .catch(() => resolve([]));
          });
      });
  })
    .finally(() => delete robotsTxtQueue[host]);

  return robotsTxtQueue[host];
};

/**
 * Anonymously track detected applications for research purposes
 */
wappalyzer.driver.ping = (hostnameCache = {}, adCache = []) => {
  getOption('tracking', true)
    .then((tracking) => {
      if (tracking) {
        if (Object.keys(hostnameCache).length) {
          post('https://api.wappalyzer.com/ping/v1/', hostnameCache);
        }

        if (adCache.length) {
          post('https://ad.wappalyzer.com/log/wp/', adCache);
        }

        setOption('robotsTxtCache', {});
      }
    });
};
