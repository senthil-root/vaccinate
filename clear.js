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
const lettersRegExp = /\<path fill.+?\>/g;

const widthRegExp   = /width="[0-9]+?"/g;
const heightRegExp  = /height="[0-9]+?"/g;
const viewBoxRegExp = /viewBox="[0-9,]+?"/g;

const lettersMap = new HashMap();

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache  = new NodeCache({useClones: false});

let onLoad           = true;
let availabilty      = false;
let availableSession = 0;
dotenv.config()

const schemaCaptcha = {
    properties: {
        captcha: {
            description: 'Enter Captcha',
            required   : true
        }
    }
};

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


function SaveCaptchaData(svgData, captchaString) {
    const dir = './letters/'
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    const lettersFound = svgData.match(lettersRegExp);


    for (let pos = 0; pos < lettersFound.length; pos++) {
        const letter         = lettersFound[pos];
        const letterSVG      = `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="250" viewBox="0,0,150,50">${letter}</svg>`;
        const letterPosition = getLetterPosition(letter.slice(0, 48));
        lettersMap.set(letterPosition, letterSVG);
    }
    const letters = lettersMap.keys();
    letters.sort((a, b) => a - b);
    for (let pos = 0; pos < letters.length; pos++) {
        const id             = shortid.generate();
        const letterPosition = letters[pos];
        const letterSVG      = lettersMap.get(letterPosition);
        console.log(letterPosition);
        fs.writeFile(`${dir}letter${pos}-${id}.svg`, letterSVG, function (err) {
            if (err) throw err;
            sharp(`${dir}letter${pos}-${id}.svg`)
                .sharpen()
                .normalise()
                .negate()
                .extend({
                    top   : 4,
                    bottom: 8,
                    left  : 4,
                    right : 4
                })
                .flatten({background: '#FFFFFF'})
                .png()
                .trim().toFile(`${dir}${captchaString.charAt(pos)}.png`)
                .then(function (info) {
                    fs.unlinkSync(`${dir}letter${pos}-${id}.svg`);
                    const Letter = captchaString.charAt(pos);
                    Jimp.read(`${dir}${Letter}.png`).then(image => {
                        const LetterHash = image.hash();
                        console.log(Letter);
                        console.log(LetterHash);
                        const result = spawn.sync('catimg', ['-H', '50', `${dir}${Letter}.png`], {stdio: 'inherit'});
                    });
                });
        })
    }


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

    for (let pos = 0; pos < 1; pos++) {
        needle.post(`${baseUrl}/auth/getRecaptcha`, '{}', options, function (err, resp) {
            const responseBody = resp.body;
            const file         = './capcha.svg';
            const svgData      = responseBody.captcha.replace(searchRegExp, replaceWith).replace(searchRegExp2, replaceWith2);
            // .replace(widthRegExp, 'width="750"').replace(heightRegExp, 'height="250"')
            // .replace(viewBoxRegExp, 'viewBox="0,0,750,250"');

            fs.outputFile(file, svgData, err => {
                sharp('./capcha.svg')
                    .resize({height: 50})
                    .flatten({background: '#e1e1E1'})
                    .sharpen()
                    .normalise()
                    .negate()
                    .jpeg({
                        quality: 100
                    })
                    .withMetadata({density: 700})
                    .toFile("./capcha.jpeg")
                    .then(function (info) {
                        const result = spawn.sync('catimg', ['-H', '50', './capcha.jpeg'], {stdio: 'inherit'});
                        prompt.get(schemaCaptcha, function (err, resultCaptcha) {
                            SaveCaptchaData(svgData, resultCaptcha.captcha);
                        });
                    });
            })

        });
    }

    const dir = './letters/'

    // looksSame(`${dir}7.png`, `${dir}7_1.png`, {
    //     tolerance            : 60,
    //     ignoreAntialiasing   : true,
    //     antialiasingTolerance: 80
    // }, function (error, output) {
    //     // equal will be true, if images looks the same
    //     console.error(error)
    //     console.log(chalk.green(JSON.stringify(output, null, 2)));
    // });
    //
    // looksSame.createDiff({
    //     reference            : `${dir}7.png`,
    //     current              : `${dir}7_1.png`,
    //     diff                 : `${dir}7_Diff.png`,
    //     highlightColor       : '#ff00ff', // color to highlight the differences
    //     strict               : false, // strict comparsion
    //     tolerance            : 60,
    //     antialiasingTolerance: 80,
    //     ignoreAntialiasing   : true, // ignore antialising by default
    //     ignoreCaret          : true // ignore caret by default
    // }, function (error) {
    //
    // });
    // compare();

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

function getLetterPosition(svgData) {
    const firstPointRegEx = /d=\"[A-Z](.+?) /g
    const lettersFound    = firstPointRegEx.exec(svgData);
    // console.log("svgData " + JSON.stringify(svgData));
    // console.log("lettersFound " + JSON.stringify(lettersFound));


    if (lettersFound !== undefined && lettersFound.length >= 2) {
        return Number(lettersFound[1]);
    } else {
        return 0;
    }
}


async function compare() {
    const dir = './letters/'

    const edinburgh_original  = await Jimp.read(`${dir}b.png`);
    const edinburgh_sharpened = await Jimp.read(`${dir}b_1.png`);
    const other               = await Jimp.read(`${dir}5.png`);

    console.log("Images compared to edinburgh_original.jpg\n=========================================");
    console.log(`hash (base 64) ${edinburgh_original.hash()}`);
    console.log(`hash (binary)  ${edinburgh_original.hash(2)}\n`);

    console.log("edinburgh_sharpened.jpg\n=======================");
    console.log(`hash (base 64) ${edinburgh_sharpened.hash()}`);
    console.log(`hash (binary)  ${edinburgh_sharpened.hash(2)}`);
    console.log(`distance       ${Jimp.distance(edinburgh_original, edinburgh_sharpened)}`);
    console.log(`diff.percent   ${Jimp.diff(edinburgh_original, edinburgh_sharpened).percent}\n`);

    console.log("other.jpg\n=======================");
    console.log(`hash (base 64) ${other.hash()}`);
    console.log(`hash (binary)  ${other.hash(2)}`);
    console.log(`distance       ${Jimp.distance(edinburgh_original, other)}`);
    console.log(`diff.percent   ${Jimp.diff(edinburgh_original, other).percent}\n`);

}