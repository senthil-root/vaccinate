const needle = require("needle");
const prompt = require('prompt');
const persistence_storage = require('node-persist');
const dotenv = require("dotenv");
const chalk = require("chalk");
const async = require("async");
const HashMap = require('hashmap');
const fs = require('fs-extra')
const sharp = require('sharp');
const open = require('open');
var format = require('date-format');


const sessionsMap = new HashMap();
const beneficiariesMap = new HashMap();

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache = new NodeCache({useClones: false});

let onLoad = true;
dotenv.config()

const baseUrl = 'https://cdn-api.co-vin.in/api/v2';
const mobile_number = Number(process.env['mobile']);
const vaccine_type = process.env['type'];
const district = Number(process.env['district']);

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


persistence_storage.init({logging: false, dir: './.cache/'}).then(value => {
    jwtCache.flushAll();
    onLoad = false;
}).then(async () => {
    console.log('jwt_' + mobile_number + " : " + vaccine_type);
    const cachedToken = await persistence_storage.get('jwt_' + mobile_number);
    if (cachedToken === undefined) {
        console.log("Token Expired. Call OTP Flow... node otp.js");
        process.exit(0);
    }
    console.log(cachedToken.value);
    let decodedToken = jwt.decode(cachedToken.value, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    console.log(JSON.stringify(decodedToken, null, 4));
    console.log(`expires in ${expirySeconds} seconds`);

    var options = {
        headers: {'authorization': 'Bearer ' + cachedToken.value, accept: 'application/json'}
    }

    var postOptions = {
        headers: {'authorization': 'Bearer ' + cachedToken.value, accept: '*/*'}
    }

    var availabilty = true;

    async.parallel({
        centers: function (callback) {
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
        var itemCounter = 1;
        results.centers.forEach(function (center) {
            // $.centers[?(@.fee_type=="Paid")].sessions[?(@.vaccine=="COVISHIELD" && @.min_age_limit>18  && @.available_capacity>0)]
            const {fee_type} = center;
            if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
                center.sessions.forEach(function (session) {
                    if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] > 0) {
                        console.log(chalk.bold(`  ${itemCounter}  )${session.date} - ${session.vaccine} - ${center.name} - ${center.block_name} : [${session.available_capacity}]`));
                        sessionsMap.set(itemCounter.toString(), session);
                        itemCounter++;
                        availabilty = true;
                    }
                });
                center.sessions.forEach(function (session) {
                    if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] === 0) {
                        console.log(chalk.grey(`x ${itemCounter} x)${session.date} - ${session.vaccine} - ${center.name} - ${center.block_name} : [${session.available_capacity}]`));
                        sessionsMap.set(itemCounter.toString(), session);
                        itemCounter++;
                    }
                })
            }
        });
        if (availabilty === true) {
            var personCounter = 1;
            console.log("Booking for : ");
            results.beneficiaries.forEach(function (beneficiary) {
                console.log(personCounter + ") " + beneficiary.name);
                beneficiariesMap.set(personCounter.toString(), beneficiary);
                personCounter++;
            })
            console.log("all) As Group");

            var schema = {
                properties: {
                    selectCenter: {
                        description: 'Enter Session to choose',
                        required: true
                    },
                    selectBeneficiaries: {
                        description: 'Enter Beneficiaries to select',
                        required: true
                    }
                }
            };
            var schemaSlot = {
                properties: {
                    selectSlot: {
                        description: 'Enter Slot to choose',
                        required: true
                    },
                    captcha: {
                        description: 'Enter Captcha',
                        required: true
                    }
                }
            };
            prompt.start();
            let promise = prompt.get(schema, function (err, result) {
                console.log(result);
                const beneficiaries = beneficiariesMap.get(result.selectBeneficiaries);
                const sessionSelected = sessionsMap.get(result.selectCenter);
                console.log(JSON.stringify(sessionSelected.slots));
                needle.post(`${baseUrl}/auth/getRecaptcha`, '{}', options, function (err, resp) {
                    const responseBody = resp.body;
                    const file = './capcha.svg';
                    fs.outputFile(file, responseBody.captcha, err => {
                        sharp('./capcha.svg')
                            .flatten({background: '#CCCCCC'})
                            .resize({height: 150})
                            .jpeg()
                            .toFile("./capcha.jpeg")
                            .then(function (info) {
                                const imageCaptcha = open('./capcha.jpeg', {wait: false});
                                prompt.get(schemaSlot, function (err, resultSlot) {
                                    // console.log(sessionSelected);
                                    // console.log(beneficiaries);

                                    let selectedSlot = sessionSelected.slots[Number(resultSlot.selectSlot) - 1];
                                    if (selectedSlot === undefined) {
                                        selectedSlot = sessionSelected.slots[sessionSelected.slots.length - 1];
                                    }
                                    var payload = {
                                        dose: 1,
                                        session_id: sessionSelected.session_id,
                                        slot: selectedSlot,
                                        captcha: resultSlot.captcha,
                                        beneficiaries: []
                                    }
                                    if (result.selectBeneficiaries === 'all' || result.selectBeneficiaries === 'a') {
                                        beneficiariesMap.forEach(function (value, key) {
                                            payload.beneficiaries.push(value.beneficiary_reference_id);
                                        });
                                    } else {
                                        payload.beneficiaries.push(beneficiaries.beneficiary_reference_id);
                                    }

                                    console.log(payload);
                                })
                                // callback(null, info);
                            })
                            .catch(function (err) {
                                console.log(err)
                            })
                    });
                });
            });
        }

        // results is now equals to: {one: 1, two: 2}
    });

});