const axios = require('axios');
const tough = require('tough-cookie'); 
const { wrapper } = require('axios-cookiejar-support');
const otplib = require('otplib');
const qs = require('qs');

const kiteUser = process.env.KITE_USER
const kitePwd = process.env.KITE_PWD
const apiKey = process.env.API_KEY
const secret = process.env.KITE_TOTP_KEY;


const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({
	withCredentials: true,  
	jar: cookieJar,         
	maxRedirects: 5,        
}));

let initUrl = ''
let request_id = ''

async function firstRequest() {
	try {
		const response = await client.get('https://kite.zerodha.com/connect/login?api_key=' + apiKey, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Accept-Encoding': 'gzip, deflate, br, zstd',
				'Connection': 'keep-alive',
				'DNT': '1',
				'Sec-GPC': '1',
				'Upgrade-Insecure-Requests': '1',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'none',
				'Sec-Fetch-User': '?1',
				'Priority': 'u=0, i'
			},
			validateStatus: (status) => status < 400,
		});
		
		// console.info('Cookies after 1 request:', cookieJar.getCookiesSync('https://kite.zerodha.com'));
		initUrl = response.request.res.responseUrl;
		console.info('Final URL after redirects:', initUrl);
		
		return response.request.res.responseUrl;
	} catch (error) {
		console.error('Error during 1 request:', error.message);
	}
}


async function secondRequest(ref_url) {
	try {
		const response = await client.post('https://kite.zerodha.com/api/login', 
			`user_id=${kiteUser}&password=${kitePwd}&type=user_id`, 
			{
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
					'Accept': 'application/json, text/plain, */*',
					'Accept-Language': 'en-US,en;q=0.5',
					'Accept-Encoding': 'gzip, deflate, br, zstd',
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-Kite-Version': '3.0.0',
					'X-Kite-Userid': kiteUser,
					'Origin': 'https://kite.zerodha.com',
					'DNT': '1',
					'Sec-GPC': '1',
					'Connection': 'keep-alive',
					'Referer': ref_url,
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-origin',
					'Priority': 'u=0'
				},
				jar: cookieJar,  
			});
		
		request_id = response.data.data.request_id
		return request_id
		console.info('Response from 2 request:', response.data);

	} catch (error) {
		console.error('Error during 2 request:', error.message);
	}
}
	
async function thirdRequest(req_id, token, ref_url) {
	try {
		
		let data = qs.stringify({
			'user_id': kiteUser,
			'request_id': req_id,
			'twofa_value': token,
			'twofa_type': 'totp',
		});
		
		const response = await client.post('https://kite.zerodha.com/api/twofa', data, 
			{
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
					'Accept': 'application/json, text/plain, */*',
					'Accept-Language': 'en-US,en;q=0.5',
					'Accept-Encoding': 'gzip, deflate, br, zstd',
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-Kite-Version': '3.0.0',
					'X-Kite-Userid': kiteUser,
					'Origin': 'https://kite.zerodha.com',
					'DNT': '1',
					'Sec-GPC': '1',
					'Connection': 'keep-alive',
					'Referer': ref_url,
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-origin',
					'Priority': 'u=0'
				},
				jar: cookieJar,  
			}
		);
		
		console.info('Response from 3 request:', response.data);
	} catch (error) {
		console.error('Error during 3 request:', error.message);
	}
}


async function fourthRequest(ref_url) {
	try {
		
		const response = await client.get(ref_url + `&skip_session=true`, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
					'Accept': 'application/json, text/plain, */*',
					'Accept-Language': 'en-US,en;q=0.5',
					'Accept-Encoding': 'gzip, deflate, br, zstd',
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-Kite-Version': '3.0.0',
					'X-Kite-Userid': kiteUser,
					'Origin': 'https://kite.zerodha.com',
					'DNT': '1',
					'Sec-GPC': '1',
					'Connection': 'keep-alive',
					'Referer': ref_url,
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-origin',
					'Priority': 'u=0'
				},
				jar: cookieJar,  
			}
		);

		return response.request.res.responseUrl;

		
		// console.info('Response from 4 request:', response.data);
	} catch (error) {
		console.error('Error during 4 request:', error.message, error.response?.data);
	}
}

async function runRequests() {
	let ref_url = await firstRequest()  
	let req_id = await secondRequest(ref_url)

	const token = otplib.authenticator.generate(secret);

	await thirdRequest(req_id, token, ref_url)

	let finalURL = await fourthRequest(ref_url)
	finalURL = new URL(finalURL)

	const rt = finalURL.searchParams.get('request_token')

	console.info(finalURL.searchParams.get('request_token'))
	// console.info(finalURL.searchParams)

	return rt
}

// runRequests();

module.exports = {
	runRequests
}