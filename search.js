const needle              = require("needle");
const prompt              = require('prompt');
const persistence_storage = require('node-persist');
const dotenv              = require("dotenv");
const chalk               = require("chalk");
const async               = require("async");
const HashMap             = require('hashmap');
const fs                  = require('fs-extra')
const sharp               = require('sharp');
const open                = require('open');
var format                = require('date-format');
const spawn               = require('cross-spawn');


const sessionsMap      = new HashMap();
const beneficiariesMap = new HashMap();

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache  = new NodeCache({useClones: false});

let onLoad = true;
dotenv.config()

const baseUrl       = 'https://cdn-api.co-vin.in/api/v2';
const mobile_number = Number(process.env['mobile']);
const vaccine_type  = process.env['type'];
const district      = Number(process.env['district']);

jwtCache.on("flush", function () {
    persistence_storage.get('jwt_' + mobile_number).then(cachedToken => {
        if (cachedToken === undefined) {
            console.log("Token Expired. Call OTP Flow... node otp.js");
            process.exit(0);
        }
        const expires_in = Math.floor(cachedToken.ttl / 1000) - Math.floor(new Date().getTime() / 1000);
        jwtCache.set('jwt_' + mobile_number, cachedToken.value, expires_in);
    });
});

async function init() {
    console.log('jwt_' + mobile_number + " : " + vaccine_type);
    return persistence_storage.get('jwt_' + mobile_number).then(cachedToken => {
        if (cachedToken === undefined) {
            console.log("Token Expired. Call OTP Flow... node otp.js");
            process.exit(0);
        }
        console.log(cachedToken.value);
        let decodedToken    = jwt.decode(cachedToken.value, '', 'HS256');
        const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
        console.log(JSON.stringify(decodedToken, null, 4));
        console.log(`expires in ${expirySeconds} seconds`);
        return decodedToken;
    });
}


var options = {
    headers: {
        'authorization': 'Bearer ' + cachedToken.value,
        accept         : 'application/json'
    }
}

var postOptions = {
    headers: {
        'authorization': 'Bearer ' + cachedToken.value,
        accept         : '*/*'
    }
}
var availabilty = true;

await persistence_storage.init({
    logging: false,
    dir    : './.cache/'
})
    .then(value => {
        jwtCache.flushAll();
        onLoad = false;
    });

await init().then(decodedToken => {
    console.log(decodedToken);
});