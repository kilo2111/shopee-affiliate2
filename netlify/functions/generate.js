const https = require('https');
const http = require('http');
const { URL } = require('url');

// Hàm theo dõi redirect để lấy link gốc
function getFinalUrl(inputUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(inputUrl);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.request(
        inputUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
          },
          timeout: 8000
        },
        (res) => {
          // Nếu có redirect
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            // Xử lý relative URL
            if (nextUrl.startsWith('/')) {
              nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
            }
            // Tiếp tục theo dõi (tối đa vài lần)
            return getFinalUrl(nextUrl).then(resolve).catch(reject);
          }

          // Không redirect nữa → đây là link cuối
          resolve(inputUrl);
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout khi lấy link gốc'));
      });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Làm sạch link sản phẩm
function cleanShopeeUrl(url) {
  try {
    const u = new URL(url);
    const removeParams = [
      'uls_trackid', 'utm_source', 'utm_medium', 'utm_campaign',
      'utm_content', 'utm_term', 'sp_atk', 'xptdk', 'smtt', 'deep_and_web'
    ];
    removeParams.forEach(p => u.searchParams.delete(p));
    return u.origin + u.pathname + (u.search || '');
  } catch (e) {
    return url;
  }
}

exports.handler = async function (event) {
  // Cho phép CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { url, subId = '' } = body;

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Thiếu link sản phẩm' })
      };
    }

    // Affiliate ID lấy từ Environment Variable
    const AFFILIATE_ID = process.env.SHOPEE_AFFILIATE_ID;
    if (!AFFILIATE_ID) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Chưa cấu hình SHOPEE_AFFILIATE_ID' })
      };
    }

    // 1. Lấy link gốc (nếu là link rút gọn)
    let finalUrl = url;
    try {
      finalUrl = await getFinalUrl(url);
    } catch (e) {
      // Nếu không theo dõi được thì dùng link gốc người dùng nhập
      finalUrl = url;
    }

    // 2. Làm sạch link
    const cleanUrl = cleanShopeeUrl(finalUrl);

    // 3. Tạo link Affiliate
    const encoded = encodeURIComponent(cleanUrl);
    let affiliateLink = `https://s.shopee.vn/an_redir?origin_link=${encoded}&affiliate_id=${AFFILIATE_ID}`;
    if (subId) {
      affiliateLink += `&sub_id=${encodeURIComponent(subId)}`;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        shortLink: affiliateLink,
        originalUrl: cleanUrl
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Lỗi server' })
    };
  }
};