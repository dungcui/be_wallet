const fetch = require('node-fetch');
const { resolve: urlResolve } = require('url');
const Promise = require('bluebird');
// const logger = require("../logger");

class Api {
    constructor({ baseUrl, sleepTime, maxAttempt, timeout }) {
        this.base = baseUrl;
        this.sleepTime = Number(sleepTime);
        this.timeout = timeout; // in ms
        // Set to 0 to disable attempt
        this.MAX_ATTEMPT = maxAttempt;
    }
    static async validateRequest(raw) {
        if (raw.status > 202) {
            const responseMsg = await raw.text();
            console.log(`GET response with status ${raw.status} - ${responseMsg} `);
            throw Error(`${raw.status} - ${responseMsg}`);
        }
    }

    async get(path, attempt = 0) {
        try {
            const url = urlResolve(this.base, path);
            const raw = await fetch(url, { timeout: this.timeout });
            await this.constructor.validateRequest(raw);
            console.log(`Get ${path} success`);
            return raw.json();
        } catch (err) {
            // No retry if MAX_ATTEMPT is 0
            if (this.MAX_ATTEMPT === 0) throw err;

            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries on path ${path}, exit.`);
            }
            console.log(`GET failed, retry...`, err);
            await Promise.delay(1000 * this.sleepTime);
            return this.get(path, attempt + 1);
        }
    }

    async post(path, body) {
        try {
            var options;
            if (this.base == 'https://dex.binance.org/')
                options = {
                    method: 'POST',
                    body: body,
                    headers: { 'Content-Type': 'text/plain' },
                    timeout: this.timeout,
                }
            else
                options = {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers: { 'Content-Type': 'application/json' },
                    timeout: this.timeout,
                }

            const url = urlResolve(this.base, path);
            const raw = await fetch(url, options);
            await this.constructor.validateRequest(raw);
            return raw.json();
        } catch (err) {
            console.log("exception apu", err);
            throw Error("time out");
        }

    }

    async postWithSignature(path, body, signature) {
        var options = {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', 'signature': signature },
            timeout: this.timeout,
        }
        const url = urlResolve(this.base, path);
        const raw = await fetch(url, options);
        await this.constructor.validateRequest(raw);
        return raw.json();
    }



    async sendRequest(path, body) {
        const options = {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            timeout: this.timeout,
        };
        const url = urlResolve(this.base, path);
        await fetch(url, options);
    }
}

module.exports = Api;
