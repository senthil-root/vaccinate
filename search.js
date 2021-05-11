const needle = require("needle");
const persistence_storage = require('node-persist');
const dotenv = require("dotenv");

let jwt = require('jwt-simple');

const NodeCache = require("node-cache");
const jwtCache = new NodeCache({useClones: false});

let onLoad = true;
dotenv.config()

const mobile_number = Number(process.env['mobile']);
const vaccine_type = process.env['type'];

jwtCache.on("flush", function () {
    persistence_storage.get('jwt_' + mobile_number).then(cachedToken => {
        console.log(cachedToken);
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
    if (!cachedToken) {
        console.log("Token Expired. Call OTP Flow... node otp.js");
        process.exit(0);
    }
    console.log(cachedToken.value);
    let decodedToken = jwt.decode(cachedToken.value, '', 'HS256');
    const expirySeconds = decodedToken['exp'] - Math.floor(new Date().getTime() / 1000);
    console.log(JSON.stringify(decodedToken, null, 4));
    console.log(`expires in ${expirySeconds} seconds`);
    const district = 571;


    var options = {
        headers: {'authorization': 'Bearer ' + cachedToken.value, accept: 'application/json'}
    }


    await needle.get('https://cdn-api.co-vin.in/api/v2/appointment/sessions/calendarByDistrict?district_id=571&date=11-05-2021', options, function (err, resp) {
        const responseBody = resp.body;
        var itemCounter = 1;
        if (responseBody.hasOwnProperty("centers")) {
            responseBody.centers.forEach(function (center) {
                // $.centers[?(@.fee_type=="Paid")].sessions[?(@.vaccine=="COVISHIELD" && @.min_age_limit>18  && @.available_capacity>0)]
                const {fee_type} = center;
                if (fee_type === "Paid" && center.hasOwnProperty("sessions")) {
                    center.sessions.forEach(function (session) {
                        if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] > 0) {
                            // console.log(session);
                            console.log(itemCounter++ + ") " + session.date + " - " + session.vaccine + " - " + center.name + " - " + center.block_name + " : [" + session.available_capacity + "]");
                        }
                    });
                    center.sessions.forEach(function (session) {
                        if (session["vaccine"] === vaccine_type && session["min_age_limit"] < 45 && session["available_capacity"] === 0) {
                            // console.log(session);
                            console.log("xx) " + session.date + " - " + session.vaccine + " - " + center.name + " - " + center.block_name + " : [" + session.available_capacity + "]");
                        }
                    })

                }
            })
        }
    });


    await needle.get('https://cdn-api.co-vin.in/api/v2/appointment/beneficiaries', options, function (err, resp) {
        const responseBody = resp.body;
        var personCounter = 1;
        if (responseBody.hasOwnProperty("beneficiaries")) {
            console.log("Booking for : ");
            responseBody.beneficiaries.forEach(function (beneficiary) {
                console.log(personCounter++ + ") " + beneficiary.name);
            })
            console.log("all) As Group");
        }

    });


});
