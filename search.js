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
const format              = require('date-format');
const spawn               = require('cross-spawn');
const jwt                 = require('jwt-simple');

dotenv.config()

const sessionsMap      = new HashMap();
const beneficiariesMap = new HashMap();
const NodeCache        = require("node-cache");
const jwtCache         = new NodeCache({useClones: false});
const baseUrl          = 'https://cdn-api.co-vin.in/api/v2';
const mobile_number    = Number(process.env['mobile']);
const vaccine_type     = process.env['type'];
const district         = Number(process.env['district']);

let availabilty = true;
let onLoad      = true;

let getRequestOptions = {
    headers: {
        authorization : 'Bearer <JWT>',
        accept        : 'application/json',
        authority     : 'cdn-api.co-vin.in',
        origin        : 'https://selfregistration.cowin.gov.in',
        referer       : 'https://selfregistration.cowin.gov.in/',
        'user-agent'  : 'Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        'content-type': 'application/json'
    }
}

let postRequestOptions = {
    headers: {
        authorization : 'Bearer <JWT>',
        accept        : '*/*',
        authority     : 'cdn-api.co-vin.in',
        origin        : 'https://selfregistration.cowin.gov.in',
        referer       : 'https://selfregistration.cowin.gov.in/',
        'user-agent'  : 'Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        'content-type': 'application/json'
    }
}

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
    return await persistence_storage.get('jwt_' + mobile_number).then(cachedToken => {
        if (cachedToken === undefined) {
            console.log("Token Expired. Call OTP Flow... node otp.js");
            process.exit(0);
        } else {
            let decodedToken    = jwt.decode(cachedToken.value, '', 'HS256');
            const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
            console.log(`Token : Expires in ${expirySeconds} seconds`);
            if (expirySeconds < 0) {
                console.log("Token Expired. Call OTP Flow... node otp.js");
                process.exit(0);
            }
            return cachedToken.value;
        }
    });
}

async function searchSlots(district) {
    const currentDate = format('dd-MM-yyyy', new Date());

    needle.get(`${baseUrl}/appointment/sessions/calendarByDistrict?district_id=${district}&date=${currentDate}`, getRequestOptions, function (err, resp) {
        const responseBody = resp.body;
        if (responseBody.hasOwnProperty("centers")) {
            console.log(responseBody.centers.length + " Centers Found ");
            return responseBody.centers
        } else {
            return [];
        }
    })
}

persistence_storage.init({
    logging: false,
    dir    : './.cache/'
}).then(async (value) => {
    jwtCache.flushAll();
    onLoad                                   = false;
    const Token                              = await init();
    getRequestOptions.headers.authorization  = `Bearer ${Token}`;
    postRequestOptions.headers.authorization = `Bearer ${Token}`;
    console.log(Token);
    let itemCounter = 1;
    const centers   = await searchSlots(district);
    centers.forEach(center => {
        // $.centers[?(@.fee_type=="Paid")].sessions[?(@.vaccine=="COVISHIELD" && @.min_age_limit>18  && @.available_capacity>0)]
        const {fee_type}  = center;
        const {center_id} = center;
        if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
            center.sessions.forEach(function (session) {
                if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] > 0) {
                    console.log(chalk.bold(`  ${itemCounter}  )${session.date} - ${session.vaccine} - ${center.name} - ${center.block_name} : [${session.available_capacity}]`));
                    sessionsMap.set(itemCounter.toString(), {...session, ...{center_id: center_id}});
                    itemCounter++;
                    availabilty = true;
                }
            });
            center.sessions.forEach(function (session) {
                if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] === 0) {
                    console.log(chalk.grey(`x ${itemCounter} x)${session.date} - ${session.vaccine} - ${center.name} - ${center.block_name} : [${session.available_capacity}]`));
                    sessionsMap.set(itemCounter.toString(), {...session, ...{center_id: center_id}});
                    itemCounter++;
                }
            })
        }
    });
});