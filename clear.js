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
const crypto              = require("crypto");
const Jimp                = require('jimp');
var looksSame             = require('looks-same');
const shortid             = require('shortid');
const {optimize}          = require('svgo');


const sessionsMap      = new HashMap();
const beneficiariesMap = new HashMap();
const districts        = new Set();
const dates            = new Set();
const centers          = new Set();

const searchRegExp  = /\<path d.+?stroke.+?\>/g;
const replaceWith   = '';
const searchRegExp2 = /path fill=\".+?\"/g;
const replaceWith2  = 'path fill="#000"';
const lettersRegExp = /\<path fill.+?\>/g

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache  = new NodeCache({useClones: false});

let onLoad           = true;
let availabilty      = false;
let availableSession = 0;
dotenv.config()

const baseUrl       = 'https://cdn-api.co-vin.in/api/v2';
const mobile_number = Number(process.env['mobile']);
let district        = Number(process.env['district']);
let vaccine_type    = process.env['type'];
let dose            = process.env.hasOwnProperty('dose') ? Number(process.env['dose']) : 1;

process.argv.forEach(function (val, index, array) {
    if (index === 2 && (val.toUpperCase() === "COVAXIN" || val.toUpperCase() === "COVISHIELD")) {
        vaccine_type = val.toUpperCase();
    }
    if (index === 3) {
        district = val;
    }
});

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


function SaveCaptchaData(svgData) {
    const dir = './letters/'
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    const lettersFound = svgData.match(lettersRegExp);
    console.log(lettersFound.length);

    for (let pos = 0; pos < lettersFound.length; pos++) {
        const id                 = shortid.generate();
        const letter             = lettersFound[pos];
        const letterSVG          = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0,0,150,50">${letter}</svg>`;
        const result             = optimize(letterSVG, {
            // optional but recommended field
            path: 'path-to.svg',
            // all config fields are also available here
            multipass: true
        })
        const optimizedletterSVG = result.data

        fs.writeFile(`${dir}letter${pos}-${id}.svg`, optimizedletterSVG, function (err) {
            if (err) throw err;
            sharp(`${dir}letter${pos}-${id}.svg`)
                .trim()
                .resize({width: 300})
                .sharpen()
                .normalise()
                .negate()
                .extend({
                    top   : 40,
                    bottom: 80,
                    left  : 40,
                    right : 40
                })
                .flatten({background: '#FFFFFF'})
                .jpeg().toFile(`${dir}segment${pos}-${id}.jpeg`)
                .then(function (info) {
                    console.log(info);
                    // fs.unlinkSync(`${dir}letter${pos}-${id}.svg`);
                });
        });
    }
    // looksSame(`${dir}c.png`, `${dir}c_1.png`, {
    //     tolerance            : 9,
    //     ignoreAntialiasing   : true,
    //     antialiasingTolerance: 20
    // }, function (error, output) {
    //     // equal will be true, if images looks the same
    //     console.error(error)
    //     console.log(chalk.green(JSON.stringify(output, null, 2)));
    // });
    //
    // looksSame.createDiff({
    //     reference            : `${dir}c.png`,
    //     current              : `${dir}c_1.png`,
    //     diff                 : `${dir}c_Diff.png`,
    //     highlightColor       : '#ff00ff', // color to highlight the differences
    //     strict               : false, // strict comparsion
    //     tolerance            : 5,
    //     antialiasingTolerance: 10,
    //     ignoreAntialiasing   : true, // ignore antialising by default
    //     ignoreCaret          : true // ignore caret by default
    // }, function (error) {
    //
    // });
}


persistence_storage.init({
    logging: false,
    dir    : './.cache/'
}).then(value => {
    jwtCache.flushAll();
    onLoad = false;
}).then(async () => {
    console.log('Registered Mobile  : ' + chalk.blueBright(chalk.bold(mobile_number)));
    console.log('Searching  For     : ' + chalk.blueBright(chalk.bold(vaccine_type)));
    console.log('Booking            : ' + chalk.blueBright(chalk.bold(with_ordinal(dose))) + ' Dose');
    const cachedToken = await persistence_storage.get('jwt_' + mobile_number);
    if (cachedToken === undefined) {
        console.log("Token Expired. Call OTP Flow... node otp.js");
        process.exit(0);
    }

    let decodedToken    = jwt.decode(cachedToken.value, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    if (expirySeconds < 0) {
        console.log("Token Expired. Call OTP Flow... node otp.js");
        process.exit(0);
    } else if (expirySeconds < 120) {
        console.log('Token Expires in   : ' + chalk.bgRed(chalk.grey(chalk.bold(`${expirySeconds} seconds`))));
    } else {
        console.log('Token Expires in   : ' + chalk.bgBlue(chalk.white(chalk.bold(`${expirySeconds} seconds`))));
    }

    var getOptions = {
        headers: {
            'authorization'   : 'Bearer ' + cachedToken.value,
            'accept'          : 'application/json, text/plain, */*',
            'origin'          : 'https://selfregistration.cowin.gov.in',
            'referer'         : 'https://selfregistration.cowin.gov.in/',
            'user-agent'      : 'Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
            'content-type'    : 'application/json',
            'pragma'          : 'no-cache',
            'cache-control'   : 'no-cache',
            'sec-ch-ua'       : '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
            'sec-ch-ua-mobile': '?0',
            'sec-fetch-site'  : 'cross-site',
            'sec-fetch-mode'  : 'cors',
            'sec-fetch-dest'  : 'empty',
            'accept-language' : 'en-IN,en;q=0.9,ta-IN;q=0.8,ta;q=0.7,en-GB;q=0.6,en-US;q=0.5.'
        }
    }


    let options = {
        headers: Object.assign({}, getOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
    };

    for (let pos = 0; pos < 2; pos++) {
        needle.post(`${baseUrl}/auth/getRecaptcha`, '{}', options, function (err, resp) {
            const responseBody = resp.body;
            const file         = './capcha.svg';
            const svgData      = responseBody.captcha.replace(searchRegExp, replaceWith).replace(searchRegExp2, replaceWith2);
            SaveCaptchaData(svgData);
        });
    }

});

function with_ordinal(value) {
    const j = value % 10,
          k = value % 100;
    if (j === 1 && k !== 11) {
        return value + "ˢᵀ";
    }
    if (j === 2 && k !== 12) {
        return value + "ᴺᴰ";
    }
    if (j === 3 && k !== 13) {
        return value + "ᴿᴰ";
    }
    return value + "ᵀᴴ";
}