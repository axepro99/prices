import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';

const BASE_URL = 'https://www.ea.com/ea-play/subscribe';
const EXCHANGE_RATES_URL = 'https://api.exchangerate.host/latest?base=EUR';

// Country -> currency code (ISO 4217)
const countryCurrency = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', UY: 'UYU', EC: 'USD',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', AT: 'EUR', CH: 'CHF', IT: 'EUR', ES: 'EUR', PT: 'EUR',
  NL: 'EUR', BE: 'EUR', LU: 'EUR', PL: 'PLN', CZ: 'CZK', SK: 'EUR', HU: 'HUF', RO: 'RON', BG: 'BGN',
  GR: 'EUR', HR: 'EUR', SI: 'EUR', DK: 'DKK', SE: 'SEK', NO: 'NOK', FI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  TR: 'TRY', RU: 'RUB', UA: 'UAH', RS: 'RSD', BA: 'BAM', MK: 'MKD', AL: 'ALL',
  AU: 'AUD', NZ: 'NZD', JP: 'JPY', KR: 'KRW', HK: 'HKD', TW: 'TWD', SG: 'SGD', MY: 'MYR', ID: 'IDR', PH: 'PHP',
  VN: 'VND', TH: 'THB', IN: 'INR', PK: 'PKR',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', IL: 'ILS',
  ZA: 'ZAR', EG: 'EGP', MA: 'MAD', NG: 'NGN', KE: 'KES'
};

// Symbol → candidate ISO currency (fallback to countryCurrency for ambiguous symbols)
const symbolCurrency = {
  '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₺': 'TRY', 'R$': 'BRL', 'A$': 'AUD', 'C$': 'CAD',
  '₫': 'VND', '₪': 'ILS', '₹': 'INR', '₦': 'NGN', '₴': 'UAH', '₱': 'PHP', '₲': 'PYG', '฿': 'THB',
  '₸': 'KZT', '₡': 'CRC', '₽': 'RUB', '$': 'USD', 'CHF': 'CHF', 'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD',
  'RM': 'MYR', 'R': 'ZAR', 'zł': 'PLN', 'Kč': 'CZK', 'kr': 'SEK'
};

function extractProMonthlyPrice(html, countryCode) {
  const text = html.replace(/\s+/g, ' ');
  const proMarkers = [
    'EA Play Pro',
    'EA Play Pro-Mitgliedschaft',
    'EA Play Pro abonnement',
    'EA Play Pro suscripción',
    'EA Play Pro abbonamento'
  ];

  const currencyTokens = [
    '€','£','¥','₩','₺','R\\$','A\\$','C\\$','HK\\$','NT\\$','S\\$','RM','₪','₹','₦','₴','₱','₫','฿','₽','zł','Kč','kr',
    'CHF','USD','EUR','GBP','BRL','AUD','CAD','MXN','PLN','CZK','SEK','DKK','NOK','HUF','RON','BGN','TRY','RUB',
    'UAH','JPY','KRW','TWD','HKD','SGD','MYR','IDR','PHP','THB','INR','ZAR','EGP','MAD','NGN','KES','ARS','CLP','COP','PEN','UYU'
  ].join('|');

  const pricePattern1 = new RegExp(`(${currencyTokens})\\s*([0-9]+(?:[\\.,][0-9]{1,2})?)\\s*(?:/|per)?\\s*(?:month|mo\\.?|mensual|monat|mes|mês)?`, 'i');
  const pricePattern2 = new RegExp(`([0-9]+(?:[\\.,][0-9]{1,2})?)\\s*(${currencyTokens})\\s*(?:/|per)?\\s*(?:month|mo\\.?|mensual|monat|mes|mês)?`, 'i');

  for (const marker of proMarkers) {
    const idx = text.toLowerCase().indexOf(marker.toLowerCase());
    if (idx >= 0) {
      const windowText = text.slice(idx, idx + 800);
      let m = windowText.match(pricePattern1);
      let symbolOrCode, amountStr;
      if (m) [ , symbolOrCode, amountStr ] = m;
      if (!m) {
        m = windowText.match(pricePattern2);
        if (m) [ , amountStr, symbolOrCode ] = m;
      }
      if (m) {
        const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
        if (!isFinite(amount)) continue;
        let ccy = symbolCurrency[symbolOrCode] || symbolOrCode;
        if (!/^[A-Z]{3}$/.test(ccy)) ccy = countryCurrency[countryCode] || 'USD';
        return { amount, currency: ccy, raw: symbolOrCode };
      }
    }
  }

  const general = text.match(pricePattern1) || text.match(pricePattern2);
  if (general) {
    let symbolOrCode, amountStr;
    if (general[1].match(/^[A-Z]{2,3}$|[^0-9]/)) {
      symbolOrCode = general[1];
      amountStr = general[2];
    } else {
      amountStr = general[1];
      symbolOrCode = general[2];
    }
    const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
    if (isFinite(amount)) {
      let ccy = symbolCurrency[symbolOrCode] || symbolOrCode;
      if (!/^[A-Z]{3}$/.test(ccy)) ccy = countryCurrency[countryCode] || 'USD';
      return { amount, currency: ccy, raw: symbolOrCode };
    }
  }

  return null;
}

async function fetchLocalePage(locale) {
  const url = `${BASE_URL}?setLocale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, {
    headers: {
      'Accept-Language': locale,
      'User-Agent': 'Mozilla/5.0 (price-scout)',
      'Cookie': `ealocale=${locale}; Path=/;`
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function getFxRates() {
  const res = await fetch(EXCHANGE_RATES_URL);
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.rates) throw new Error('FX payload missing rates');
  return data.rates; // base EUR
}

function convertToEUR(amount, currency, eurRates) {
  if (currency === 'EUR') return amount;
  const rate = eurRates[currency];
  if (!rate) return null;
  return amount / rate; // rates are currency per 1 EUR
}

async function main() {
  const locales = JSON.parse(await readFile('locales.json', 'utf8'));
  const eurRates = await getFxRates();
  const limit = pLimit(6);

  const results = await Promise.all(locales.map(({ country, code, locale }) =>
    limit(async () => {
      try {
        await wait(Math.random() * 300);
        const html = await fetchLocalePage(locale);
        const price = extractProMonthlyPrice(html, code);
        if (!price) return { country, code, locale, ok: false, reason: 'price_not_found' };
        const eur = convertToEUR(price.amount, price.currency, eurRates);
        if (eur == null || !isFinite(eur)) {
          return { country, code, locale, ok: false, reason: `no_fx_${price.currency}`, price };
        }
        return { country, code, locale, ok: true, price_local: price, price_eur: eur };
      } catch (e) {
        return { country, code, locale, ok: false, reason: e.message };
      }
    })
  ));

  const ok = results.filter(r => r.ok).sort((a, b) => a.price_eur - b.price_eur);
  const top5 = ok.slice(0, 5);

  let summaryLines = [];
  summaryLines.push('Top 5 cheapest EA Play Pro monthly (approx, converted to EUR):');
  top5.forEach((r, i) => {
    const p = r.price_local;
    summaryLines.push(`${i + 1}. ${r.country} (${r.locale}) — ${p.amount} ${p.currency} ≈ ${r.price_eur.toFixed(2)} EUR`);
  });

  console.log(summaryLines.join('\n'));

  const summary = {
    generatedAtUTC: new Date().toISOString(),
    note: 'Heuristic scrape; EA may geolocate prices. Use local IPs for authoritative results.',
    top5: top5.map(r => ({
      rank: ok.indexOf(r) + 1,
      country: r.country,
      code: r.code,
      locale: r.locale,
      local_amount: r.price_local.amount,
      local_currency: r.price_local.currency,
      eur: Number(r.price_eur.toFixed(4))
    }))
  };

  await writeFile('results.json', JSON.stringify({ summary, results }, null, 2), 'utf8');

  const lines = ['country,code,locale,ok,local_amount,local_currency,price_eur,reason'];
  for (const r of results) {
    if (r.ok) {
      lines.push([
        r.country, r.code, r.locale, 'true',
        r.price_local.amount, r.price_local.currency, r.price_eur.toFixed(4), ''
      ].map(v => String(v).replaceAll('"', '""')).map(v => `"${v}"`).join(','));
    } else {
      lines.push([
        r.country, r.code, r.locale, 'false', '', '', '', r.reason || ''
      ].map(v => String(v).replaceAll('"', '""')).map(v => `"${v}"`).join(','));
    }
  }
  await writeFile('results.csv', lines.join('\n'), 'utf8');

  // If running on GitHub Actions, write summary to the job summary file
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n') + '\n', { flag: 'a' });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});