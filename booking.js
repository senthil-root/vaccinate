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
let vaccine_type    = process.env.hasOwnProperty(process.env['type']) ? process.env['type'] : "COVAXIN"; // COVAXIN is better
let dose            = process.env.hasOwnProperty('dose') ? Number(process.env['dose']) : 1;

process.argv.forEach(function (val, index, array) {
    if (index === 2 && (val.toUpperCase() === "COVAXIN" || val.toUpperCase() === "COVISHIELD")) {
        vaccine_type = val.toUpperCase();
    }
    if (index === 3) {
        district = val;
    }
    if (index === 4) { // Adding dose as another parameter.
        dose = val;
    }
});

if (isNaN(mobile_number) || isNaN(district)) {
    console.log('Either Registered Mobile  or distict is not a number.');
    console.log("Provided Phone number:" + chalk.redBright(chalk.bold(mobile_number)));
    console.log("Provided distict number:" + chalk.redBright(chalk.bold(district)));
    console.log("Read the README.md to setup the environments");
    process.exit(0);
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


function SaveCaptchaData(svgData) {
    const dir = './letters/'
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    const lettersFound = svgData.match(lettersRegExp);
    console.log(lettersFound.length);


    for (let pos = 0; pos < lettersFound.length; pos++) {
        const letter    = lettersFound[pos];
        const letterSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0,0,150,50">${letter}</svg>`;
        fs.writeFile(`${dir}letter${pos}.svg`, letterSVG, function (err) {
            if (err) throw err;
            sharp(`${dir}letter${pos}.svg`)
                .resize({
                    width   : 150,
                    height  : 150,
                    fit     : sharp.fit.cover,
                    position: sharp.strategy.entropy
                })
                .flatten({background: '#e1e1E1'})
                .sharpen()
                .normalise()
                .negate()
                .png().toFile(`${dir}segment${pos}.png`)
                .then(function (info) {
                    console.log(info);
                    fs.unlinkSync(`${dir}letter${pos}.svg`);
                });
        });
    }
    // looksSame(`${dir}Q.png`, `${dir}Q_1.png`, {
    //     tolerance            : 5,
    //     ignoreAntialiasing   : true,
    //     antialiasingTolerance: 10
    // }, function (error, output) {
    //     // equal will be true, if images looks the same
    //     console.error(error)
    //     console.log(chalk.green(JSON.stringify(output, null, 2)));
    // });

    // looksSame.createDiff({
    //     reference            : `${dir}Q.png`,
    //     current              : `${dir}Q_1.png`,
    //     diff                 : `${dir}Q_Diff.png`,
    //     highlightColor       : '#ff00ff', // color to highlight the differences
    //     strict               : false, // strict comparsion
    //     tolerance            : 5,
    //     antialiasingTolerance: 7,
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

    // var postOptions = {headers: Object.assign({}, getOptions.headers, {accept: '*/*'})};
    var postOptions = {
        headers: Object.assign({}, getOptions.headers, {accept: 'application/json, text/plain, */*'})
    };


    async.parallel({
        centers      : function (callback) {
            const currentDate = format('dd-MM-yyyy', new Date());
            let options       = {
                headers: Object.assign({}, getOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
            };
            needle.get(`${baseUrl}/appointment/sessions/calendarByDistrict?district_id=${district}&date=${currentDate}&vaccine=${vaccine_type}`, options, function (err, resp) {
                const responseBody = resp.body;
                if (responseBody.hasOwnProperty("centers")) {
                    callback(null, responseBody.centers);
                } else {
                    callback(null, []);
                }
            })
        },
        beneficiaries: function (callback) {
            let options = {
                headers: Object.assign({}, getOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
            };
            needle.get(`${baseUrl}/appointment/beneficiaries`, options, function (err, resp) {
                const responseBody = resp.body;

                if (responseBody.hasOwnProperty("beneficiaries")) {
                    callback(null, responseBody.beneficiaries);
                } else {
                    callback(null, []);
                }
            });
        }
    }, function (err, results) {
        var itemCounter      = 1;
        let available        = 0;
        let availableCenters = 0;
        let maxcharLength    = 0;
        results.centers.forEach(function (center) {
            // $.centers[?(@.fee_type=="Paid")].sessions[?(@.vaccine=="COVISHIELD" && @.min_age_limit>18  && @.available_capacity>0)]
            const {fee_type}  = center;
            const {center_id} = center;
            const {name}      = center;

            // if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
            //     console.log(center.name + ' -- ' + center.fee_type);
            //     center.sessions.forEach(function (session) {
            //         if (session["vaccine"] !== vaccine_type) {
            //             console.log(JSON.stringify(center, null, 2));
            //         }
            //     });
            // }

            if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
                districts.add(center.district_name);
                center.sessions.forEach(function (session) {
                    if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45) {
                        centers.add(center.name);
                        dates.add(session["date"]);
                        sessionsMap.set(center.name + '_' + session.date, {
                            ...session, ...{
                                center_id  : center_id,
                                center_name: name
                            }
                        });
                        const availabiltyForDose = dose === 2 ? session.available_capacity_dose2 : session.available_capacity_dose1;
                        if (availabiltyForDose > 0) available++;
                        if (maxcharLength < center.name.length) maxcharLength = center.name.length;
                    }
                });
            }
        });


        console.log(`Centers Found      : ${chalk.blueBright(chalk.bold(results.centers.length))} in ${Array.from(districts).join(',')}`);
        if (available > 0) {
            console.log(`Sessions Available : ${chalk.blueBright(chalk.bold(available))} in ${Array.from(districts).join(',')}`);
        } else {
            console.log(`Sessions Available : ${chalk.blueBright(chalk.bold(available))} in ${Array.from(districts).join(',')}`);

        }
        results.centers.forEach(function (center) {
            const {fee_type} = center;
            if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
                center.sessions.forEach(function (session) {
                    if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45) {
                        const total = session.available_capacity.toString().padStart(3, ' ');
                        const avl1  = session.available_capacity_dose1.toString().padStart(3, ' ');
                        const avl2  = session.available_capacity_dose2.toString().padStart(3, ' ');
                        console.log(chalk.bold(`${session.date} - ${session.session_id} - [${avl1}] [${avl2}] [${total}] :  ${center.block_name.padEnd(12, ' ')} ${center.name}`));
                        itemCounter++;
                    }
                });
            }
        });
        console.log(chalk.bgBlackBright(chalk.bold(`${'Dates'.padStart(maxcharLength + 1, ' ')}  : ${Array.from(dates).sort().join('  │  ')}  │`)));
        itemCounter             = 1;
        const sessionsAvailable = [];
        Array.from(centers).sort().forEach(function (center) {
            let messageItem = chalk.bgBlue(chalk.bold(center.padStart(maxcharLength + 1, ' ') + '   '));
            Array.from(dates).sort().forEach(function (session_date) {
                const sessionItem = sessionsMap.get(center + '_' + session_date);
                if (sessionItem !== undefined) {
                    // if (sessionItem.available_capacity === 0 && '0c0ccfbc-23f5-4e8d-b83c-09571e527318' !== sessionItem.session_id) {
                    const availabiltyForDose = (Number(dose) === 2) ? Number(sessionItem.available_capacity_dose2) : Number(sessionItem.available_capacity_dose1);
                    if (availabiltyForDose === 0) {
                        messageItem += chalk.dim(itemCounter.toString().padStart(2, ' ').toString().padEnd(2, ' '));
                        messageItem += chalk.dim(chalk.underline('booked'.padStart(10, ' ')));

                    } else {
                        messageItem += chalk.bold(chalk.green(itemCounter.toString().padStart(2, ' ').toString().padEnd(2, ' ')));
                        messageItem += chalk.bold(chalk.green(chalk.underline(availabiltyForDose.toString().padStart(10, ' '))));
                        if (availableSession === 0) availableSession = itemCounter;
                        availabilty = true;
                        sessionsAvailable.push(sessionItem);
                    }
                    sessionsMap.set(itemCounter.toString(), sessionItem);
                    itemCounter++;
                } else {
                    messageItem += ' '.padStart(12, ' ');
                }
                messageItem += chalk.bold(' │ ');
            });
            console.log((messageItem));
        });
        console.log(chalk.bgBlackBright(chalk.bold(`${' '.padStart(maxcharLength + 1, ' ')}    ${Array.from(dates).sort().join('  │  ')}  │`)));

        availabilty = true;

        if (availabilty === true) {

            console.log('\u0007');
            var personCounter = 1;
            var reschedule    = false;
            var appointmentID = false;
            console.log('Booking for         ');
            results.beneficiaries.forEach(function (beneficiary) {
                console.log(`                ${personCounter}) : ${beneficiary.name}`);
                beneficiariesMap.set(personCounter.toString(), beneficiary);
                personCounter++;
                if (beneficiary.hasOwnProperty('appointments') && beneficiary.appointments.length > 0) {
                    if (reschedule === false) reschedule = true;
                    appointmentID = beneficiary.appointments[0].appointment_id;
                }
            });

            console.log("                a) : All as group");

            var schema = {
                properties: {
                    selectCenter       : {
                        description: 'Enter Session to choose',
                        required   : true
                    },
                    selectBeneficiaries: {
                        description: 'Enter Beneficiaries to select',
                        required   : true,
                        default    : '2'
                    }
                }
            };
            if (availableSession > 0) schema.properties.selectCenter.default = availableSession;
            const schemaSlot    = {
                properties: {
                    selectSlot: {
                        description: 'Enter Slot to choose',
                        required   : true
                    }
                }
            };
            const schemaCaptcha = {
                properties: {
                    captcha: {
                        description: 'Enter Captcha',
                        required   : true
                    }
                }
            };
            prompt.start();
            let promise = prompt.get(schema, function (err, result) {
                const beneficiaries   = beneficiariesMap.get(result.selectBeneficiaries);
                const sessionSelected = sessionsMap.get(result.selectCenter);

                schemaSlot.properties.selectSlot.default = sessionSelected.slots.length;

                console.log(`Slots Available    : [ ${sessionSelected.slots.join(', ')} ]`);
                prompt.get(schemaSlot, function (err, resultSlot) {
                    if (resultSlot.selectSlot === undefined) {
                        process.exit(0);
                    }

                    let selectedSlot = sessionSelected.slots[Number(resultSlot.selectSlot) - 1];
                    if (selectedSlot === undefined) {
                        selectedSlot = sessionSelected.slots[sessionSelected.slots.length - 1];
                    }
                    var payload = {
                        center_id    : sessionSelected.center_id,
                        session_id   : sessionSelected.session_id,
                        beneficiaries: [],
                        slot         : selectedSlot,
                        captcha      : 'captcha',
                        dose         : dose
                    }

                    if (result.selectBeneficiaries === 'all' || result.selectBeneficiaries === 'a') {
                        beneficiariesMap.forEach(function (value, key) {
                            payload.beneficiaries.push(value.beneficiary_reference_id);
                        });
                    } else {
                        payload.beneficiaries.push(beneficiaries.beneficiary_reference_id);
                    }

                    let options = {
                        headers: Object.assign({}, getOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
                    };
                    needle.post(`${baseUrl}/auth/getRecaptcha`, '{}', options, function (err, resp) {
                        const responseBody = resp.body;
                        const file         = './capcha.svg';
                        const svgData      = responseBody.captcha.replace(searchRegExp, replaceWith).replace(searchRegExp2, replaceWith2);
                        // SaveCaptchaData(svgData);

                        const lettersFound = svgData.toString().match(lettersRegExp);
                        for (let pos = 0; pos < lettersFound.length; pos++) {
                            const letter         = lettersFound[pos];
                            const letterSVG      = `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="250" viewBox="0,0,750,250">${letter}</svg>`;
                            const letterPosition = getLetterPosition(letter.slice(0, 48));
                            lettersMap.set(letterPosition, letterSVG);
                        }
                        getCaptchaText(results.hashes).then(value => {
                            console.log(value);
                        });

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
                                .withMetadata({density: 96})
                                .toFile("./capcha.jpeg")
                                .then(function (info) {
                                    const result = spawn.sync('catimg', ['-t', '-H', '50', './capcha.jpeg'], {stdio: 'inherit'});
                                    prompt.get(schemaCaptcha, function (err, resultCaptcha) {
                                        payload.captcha = resultCaptcha.captcha;
                                        console.log(JSON.stringify(payload, null, 2));

                                        console.log('Session            : ' + sessionSelected.session_id);
                                        console.log('Center             : ' + sessionSelected.center_name);
                                        console.log(`Slot               : ${sessionSelected.date} [${selectedSlot}]`);

                                        const scheduleURL = reschedule === false ? 'appointment/schedule' : 'appointment/reschedule';
                                        console.log(scheduleURL);
                                        if (reschedule === false) {
                                            needle.head(`${baseUrl}/schedule`, {
                                                open_timeout: 5000 // if we're not able to open a connection in 5 seconds, boom.
                                            }, function (err, resp) {

                                                let post_options = {
                                                    headers: Object.assign({}, postOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
                                                };
                                                needle.post(`${baseUrl}/appointment/schedule`, payload, post_options, function (err, resp, responseBody) {
                                                    if (resp.statusCode !== 200) {
                                                        if (responseBody.hasOwnProperty("error")) {
                                                            console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody.error))));
                                                        } else {
                                                            console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody))));
                                                        }
                                                    } else {
                                                        console.log('Booking Successful : ' + chalk.greenBright(chalk.bold(JSON.stringify(responseBody))));
                                                        if (responseBody.hasOwnProperty('appointment_confirmation_no')) {
                                                            const appointment_confirmation_no = responseBody.appointment_confirmation_no;


                                                        }
                                                    }
                                                });
                                            })

                                        } else {
                                            // appointmentID

                                            const reschedulePayload =
                                                      {
                                                          "appointment_id": appointmentID,
                                                          "session_id"    : payload.session_id,
                                                          "slot"          : payload.slot,
                                                          "captcha"       : payload.captcha
                                                      }
                                            let post_options        = {
                                                headers: Object.assign({}, postOptions.headers, {'If-None-Match': `W/"${crypto.randomBytes(5).toString('hex')}-${crypto.randomBytes(27).toString('hex')}`})
                                            };
                                            console.log(reschedulePayload);
                                            needle.post(`${baseUrl}/appointment/reschedule`, reschedulePayload, post_options, function (err, resp, responseBody) {
                                                if (resp.statusCode !== 200) {
                                                    if (responseBody.hasOwnProperty("error")) {
                                                        console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody.error))));
                                                    } else {
                                                        console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody))));
                                                    }
                                                } else {
                                                    console.log('Booking Successful : ' + chalk.greenBright(chalk.bold(JSON.stringify(responseBody))));
                                                    if (responseBody.hasOwnProperty('appointment_confirmation_no')) {
                                                        const appointment_confirmation_no = responseBody.appointment_confirmation_no;
                                                    }
                                                }
                                            });

                                        }
                                    });
                                });
                        });
                    })

                })
                ;
            });
        }
    });
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

async function getCaptchaText(hashes_letters) {
    const letters = lettersMap.keys();
    letters.sort((a, b) => a - b);
    let deductedCaptcha = [];
    for (let pos = 0; pos < letters.length; pos++) {
        const letterPosition = letters[pos];
        const letterSVG      = lettersMap.get(letterPosition);
        sharp(Buffer.from(letterSVG))
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
            .trim().toFile(`letter_${pos}.png`)
            .then(function (info) {
                Jimp.read(`letter_${pos}.png`).then(image => {
                    // const result     = spawn.sync('catimg', ['-H', '50', `letter_${pos}.png`], {stdio: 'inherit'});
                    const LetterHash = image.hash(2);
                    let matched      = false;
                    Object.entries(hashes_letters).forEach((entry) => {
                        const [key, value] = entry;
                        if (matched === false) {
                            var a      = parseInt(LetterHash, 2),
                                b      = parseInt(value, 2),
                                result = (a ^ b) ^ (1 << 8) - 1;
                            if (255 === result) {
                                console.log(chalk.bold(key + " : " + LetterHash + " : " + value + " = " + result));
                                deductedCaptcha[pos] = key.replace('.png', '');
                                console.log(chalk.bold(chalk.green(deductedCaptcha.join(''))));
                                // console.log(JSON.stringify(lettersHashesMap));
                                // console.log(JSON.stringify(hashes_letters));
                            } else {
                                // console.log(key + " : " + LetterHash + " : " + value + " = " + result);
                            }
                            // var distance = Jimp.distance(image, value); // perceived distance
                            // var diff     = Jimp.diff(image, value); // pixel difference
                            // if (distance < 0.15 && diff.percent < 0.15) {
                            //     // console.log(" Letter  is : " + key + " : " + value.hash());
                            //     matched              = true;
                            //     deductedCaptcha[pos] = key.replace('.png', '');
                            //     console.log(chalk.bold(chalk.green(deductedCaptcha.join(''))));
                            // }
                        }
                    });
                });
            })
    }
    return deductedCaptcha.join('').toString();

}
