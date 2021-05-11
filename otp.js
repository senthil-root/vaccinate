const needle = require("needle");
const dotenv = require("dotenv");
const hash = require('hash.js')
const prompt = require('prompt');
const NodeCache = require("node-cache");
const jwtCache = new NodeCache({useClones: false});
const persistence_storage = require('node-persist');
let jwt = require('jwt-simple');
var bunyan = require('bunyan');
var log = bunyan.createLogger({name: "cowin", level: 'info'});

let onLoad = true;
dotenv.config()

jwtCache.on("set", function (key, value) {
    // In Memory to Persistence
    log.info(`Saving ${key} to persistence_storage : ${value}`);
    const expires_at = jwtCache.getTtl(key);
    const expires_in = Math.floor(expires_at / 1000) - Math.floor(new Date().getTime() / 1000);
    persistence_storage.setItem(key, {value: value, ttl: expires_in}, {ttl: expires_in * 1000 /*in millis*/});
});

jwtCache.on("flush", function () {
    persistence_storage.forEach(function (datum) {
        log.info(`Retrieving ${datum.key} from persistence_storage to In Memory`);
        log.info(`${datum.value.ttl} in persistence_storage`);
        log.info(`${datum.ttl} in ttl persistence_storage`);
        const expires_in = Math.floor(datum.ttl / 1000) - Math.floor(new Date().getTime() / 1000);
        jwtCache.set(datum.key, datum.value.value, expires_in);

    });
});


persistence_storage.init({logging: false, dir: './.cache/'}).then(value => {
    log.info(value);
    jwtCache.flushAll();
    onLoad = false;
});


const secret_seed = process.env['secret'];
const mobile_number = Number(process.env['mobile']);

const vaccine_type = process.env['type'];

console.log(vaccine_type);

jwtCache.keys().forEach(function (_keyString) {
    console.log(_keyString);
});

if (jwtCache.has('jwt_' + mobile_number)) {
    const cachedToken = jwtCache.get('jwt_' + mobile_number);
    let decodedToken = jwt.decode(cachedToken, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    console.log(JSON.stringify(decodedToken, null, 4));
    log.info(`expires in ${expirySeconds} seconds`);
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

// prompt.get(schema, function (err, result) {
//     const JWT = "JWT";
//     const expirySeconds = 90;
//     jwtCache.set(mobile_number, JWT, expirySeconds);
// });

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
                        const currentTimeEpoch = Math.floor(new Date().getTime() / 1000);
                        const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);

                        log.info('currentTimeEpoch = [' + currentTimeEpoch + "]");
                        log.info('expiryTimeEpoch  = [' + decodedToken['exp'] + "]");
                        log.info('expiryTimeEpoch  = [' + expirySeconds + "]");

                        log.info(`Getting  JWT for  ${expirySeconds} through introspect end point`);
                        log.info(JSON.stringify(JWT));
                        jwtCache.set('jwt_' + mobile_number, JWT, expirySeconds);

                        prompt.stop();
                    });
            });
        });
} else {
    log.info('using ' + jwtCache.get('jwt_' + mobile_number));
    log.info('TTL ' + jwtCache.getTtl('jwt_' + mobile_number));
}