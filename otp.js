const needle = require("needle");
const dotenv = require("dotenv");
const hash = require('hash.js')
const prompt = require('prompt');
const NodeCache = require("node-cache");
const jwtCache = new NodeCache({useClones: false});
const persistence_storage = require('node-persist');
let jwt = require('jwt-simple');

let onLoad = true;
dotenv.config()

jwtCache.on("set", function (key, value) {
    // In Memory to Persistence
    console.log(`Saving ${key} to persistence_storage : ${value}`);
    const expires_at = jwtCache.getTtl(key);
    const expires_in = Math.floor(expires_at / 1000) - Math.floor(new Date().getTime() / 1000);
    persistence_storage.setItem(key, {value: value, ttl: expires_in}, {ttl: expires_in * 1000 /*in millis*/});
});

jwtCache.on("flush", function () {
    persistence_storage.forEach(function (datum) {
        const expires_in = Math.floor(datum.ttl / 1000) - Math.floor(new Date().getTime() / 1000);
        jwtCache.set(datum.key, datum.value.value, expires_in);
        console.log("Flush : " + JSON.stringify(jwtCache.stats));
    });
});

const secret_seed = process.env['secret'];
const mobile_number = Number(process.env['mobile']);

persistence_storage.init({logging: false, dir: './.cache/'}).then(value => {
    jwtCache.flushAll();
    onLoad = false;
}).then(value => {
    console.log("Then : " + JSON.stringify(jwtCache.stats));
    console.log(jwtCache.stats);
    jwtCache.keys().forEach(function (_keyString) {
        console.log(_keyString);
    });
});


if (jwtCache.has('jwt_' + mobile_number)) {
    const cachedToken = jwtCache.get('jwt_' + mobile_number);
    let decodedToken = jwt.decode(cachedToken, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    console.log(JSON.stringify(decodedToken, null, 4));
    console.log(`expires in ${expirySeconds} seconds`);
}


var schema = {
    properties: {
        otp: {
            description: 'Enter OTP (6 digits)',     // Prompt displayed to the user. If not supplied name will be used.
            pattern: /^[0-9]{1,6}$/,
            message: 'Verify OTP (6 digits)',
            required: true
        }
    }
};

if (!jwtCache.has('jwt_' + mobile_number)) {
    let data = {"secret": secret_seed, "mobile": mobile_number};
    console.log(data);
    needle('post', 'https://cdn-api.co-vin.in/api/v2/auth/generateMobileOTP', data, {json: true})
        .then(function (resp) {
            console.log(resp.body); // this little guy won't be a Gzipped binary blob
            const txnId = resp.body.txnId;
            prompt.start();
            prompt.get(schema, function (err, result) {
                console.log('Command-line input received:');
                let opthash = hash.sha256().update(result.otp).digest('hex')
                let data = {"otp": opthash, "txnId": txnId};
                console.log('Command-line input received:' + JSON.stringify(data));

                needle('post', 'https://cdn-api.co-vin.in/api/v2/auth/validateMobileOtp', data, {json: true})
                    .then(function (resp) {
                        const responseBody = resp.body;
                        const JWT = responseBody.token;
                        let decodedToken = jwt.decode(JWT, '', 'HS256');
                        const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
                        console.log(`Getting  JWT for  ${mobile_number} through OTP end point. Expiry - ${expirySeconds} seconds`);
                        jwtCache.set('jwt_' + mobile_number, JWT, expirySeconds);
                        prompt.stop();
                    });
            });
        });
} else {
    console.log('using ' + jwtCache.get('jwt_' + mobile_number));
    console.log('TTL ' + jwtCache.getTtl('jwt_' + mobile_number));
}