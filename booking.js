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
const districts        = new Set();
const dates            = new Set();
const centers          = new Set();

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache  = new NodeCache({useClones: false});

let onLoad           = true;
let availabilty      = false;
let availableSession = 0;
dotenv.config()

const baseUrl       = 'https://cdn-api.co-vin.in/api/v2';
const mobile_number = Number(process.env['mobile']);
const district      = Number(process.env['district']);
let vaccine_type    = process.env['type'];

process.argv.forEach(function (val, index, array) {
    if (index === 2 && (val.toUpperCase() === "COVAXIN" || val.toUpperCase() === "COVISHIELD")) {
        vaccine_type = val.toUpperCase();
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


persistence_storage.init({
    logging: false,
    dir    : './.cache/'
}).then(value => {
    jwtCache.flushAll();
    onLoad = false;
}).then(async () => {
    console.log('Registered Mobile  : ' + chalk.blueBright(chalk.bold(mobile_number)));
    console.log('Searching  For     : ' + chalk.blueBright(chalk.bold(vaccine_type)));
    const cachedToken = await persistence_storage.get('jwt_' + mobile_number);
    if (cachedToken === undefined) {
        console.log("Token Expired. Call OTP Flow... node otp.js");
        process.exit(0);
    }

    let decodedToken    = jwt.decode(cachedToken.value, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    console.log('Token Expires in   : ' + chalk.blueBright(chalk.bold(expirySeconds)) + ' seconds');

    var options = {
        headers: {
            authorization : 'Bearer ' + cachedToken.value,
            accept        : 'application/json',
            authority     : 'cdn-api.co-vin.in',
            origin        : 'https://selfregistration.cowin.gov.in',
            referer       : 'https://selfregistration.cowin.gov.in/',
            'user-agent'  : 'Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
            'content-type': 'application/json'
        }
    }

    var postOptions = {
        headers: {
            authorization : 'Bearer ' + cachedToken.value,
            accept        : '*/*',
            authority     : 'cdn-api.co-vin.in',
            origin        : 'https://selfregistration.cowin.gov.in',
            referer       : 'https://selfregistration.cowin.gov.in/',
            'user-agent'  : 'Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
            'content-type': 'application/json'
        }
    }


    async.parallel({
        centers      : function (callback) {
            const currentDate = format('dd-MM-yyyy', new Date());
            needle.get(`${baseUrl}/appointment/sessions/calendarByDistrict?district_id=${district}&date=${currentDate}`, options, function (err, resp) {
                const responseBody = resp.body;
                if (responseBody.hasOwnProperty("centers")) {
                    callback(null, responseBody.centers);
                } else {
                    callback(null, []);
                }
            })
        },
        beneficiaries: function (callback) {
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
                        if (session["available_capacity"] > 0) available += Number(session["available_capacity"]);
                        if (maxcharLength < center.name.length) maxcharLength = center.name.length;
                    }
                });
            }
        });

        /*
        results.centers.forEach(function (center) {
            const {fee_type} = center;
            if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
                center.sessions.forEach(function (session) {
                    if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45) {
                        console.log(chalk.bold(`  ${itemCounter}  )${session.date} - ${session.session_id} - ${center.name} - ${center.block_name} : [${session.available_capacity}]`));
                        itemCounter++;
                    }
                });
            }
        });*/

        console.log(`Centers Found      : ${chalk.blueBright(chalk.bold(results.centers.length))} in ${Array.from(districts).join(',')}`);
        console.log(`Sessions Available : ${chalk.blueBright(chalk.bold(available))} in ${Array.from(districts).join(',')}`);
        console.log(chalk.bgBlackBright(chalk.bold(`${'Dates'.padStart(maxcharLength + 1, ' ')}  : ${Array.from(dates).sort().join('  │  ')}  │`)));
        itemCounter = 1;
        Array.from(centers).sort().forEach(function (center) {
            let messageItem = chalk.bgBlueBright(chalk.bold( center.padStart(maxcharLength + 1, ' ') + '   '));
            Array.from(dates).sort().forEach(function (session_date) {
                const sessionItem = sessionsMap.get(center + '_' + session_date);
                if (sessionItem !== undefined) {
                    // if (sessionItem.available_capacity === 0 && '0c0ccfbc-23f5-4e8d-b83c-09571e527318' !== sessionItem.session_id) {
                    if (sessionItem.available_capacity === 0) {
                        messageItem += chalk.dim(itemCounter.toString().padStart(2, ' ').toString().padEnd(2, ' '));
                        messageItem += chalk.dim(chalk.underline('booked'.padStart(10, ' ')));
                    } else {
                        messageItem += chalk.bold(chalk.green(itemCounter.toString().padStart(2, ' ').toString().padEnd(2, ' ')));
                        messageItem += chalk.bold(chalk.green(chalk.underline("100".toString().padStart(10, ' '))));

                        if (availableSession === 0) availableSession = itemCounter;
                        availabilty = true;
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

        if (availabilty === true) {
            var personCounter = 1;
            console.log('Booking for         ');
            results.beneficiaries.forEach(function (beneficiary) {
                console.log(`                ${personCounter}) : ${beneficiary.name}`);
                beneficiariesMap.set(personCounter.toString(), beneficiary);
                personCounter++;
            })
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
                        dose         : 1
                    }

                    if (result.selectBeneficiaries === 'all' || result.selectBeneficiaries === 'a') {
                        beneficiariesMap.forEach(function (value, key) {
                            payload.beneficiaries.push(value.beneficiary_reference_id);
                        });
                    } else {
                        payload.beneficiaries.push(beneficiaries.beneficiary_reference_id);
                    }

                    needle.post(`${baseUrl}/auth/getRecaptcha`, '{}', options, function (err, resp) {
                        const responseBody = resp.body;
                        const file         = './capcha.svg';
                        fs.outputFile(file, responseBody.captcha, err => {
                            sharp('./capcha.svg')
                                .flatten({background: '#CCCCCC'})
                                .resize({height: 148})
                                .png()
                                .jpeg()
                                .toFile("./capcha.jpeg")
                                .then(function (info) {
                                    const result = spawn.sync('catimg', ['./capcha.jpeg'], {stdio: 'inherit'});
                                    prompt.get(schemaCaptcha, function (err, resultCaptcha) {
                                        payload.captcha = resultCaptcha.captcha;
                                        console.log(JSON.stringify(payload, null, 2));

                                        console.log('Center             : ' + sessionSelected.center_name);
                                        console.log('Session            : ' + sessionSelected.session_id);
                                        console.log(`Slot               : ${sessionSelected.date} [${selectedSlot}]`);

                                        needle.post(`${baseUrl}/appointment/schedule`, payload, postOptions, function (err, resp, responseBody) {
                                            if (resp.statusCode !== 200) {
                                                if (responseBody.hasOwnProperty("error")) {
                                                    console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody.error))));
                                                } else {
                                                    console.log('Booking Failed     : ' + chalk.red(chalk.bold(JSON.stringify(responseBody))));
                                                }
                                            } else {
                                                console.log('Booking Successful : ' + chalk.greenBright(chalk.bold(JSON.stringify(responseBody))));
                                            }
                                        });
                                    });
                                });
                        });
                    })

                })
                ;
            });
        }

        // results is now equals to: {one: 1, two: 2}
    });

});