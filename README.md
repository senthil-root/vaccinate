# Vaccinate

## Create .env with secret and mobile number

Example

```properties
mobile=999999999
type=COVAXIN
district=<district_id>
```

### Get District id from

#### State ID from
```shell
curl --silent 'https://cdn-api.co-vin.in/api/v2/admin/location/states' \
-H 'user-agent: Mozilla/5.0' | jq '.states[]  | select(.state_name == "Tamil Nadu") | .state_id'
```
#### District ID from
```shell
curl --silent 'https://cdn-api.co-vin.in/api/v2/admin/location/districts/31' \
-H 'user-agent: Mozilla/5.0' | jq '.districts[]  | select(.district_name == "Chennai") | .district_id'
```

## Get Token

```shell
node otp.js
```

## Search Availability and Book

```shell
node booking.js <COVAXIN|COVISHIELD>
```

## Dependency

- [catimg](https://github.com/posva/catimg) - for Captcha

## License

MIT

**Free and Open Source Software, Yeah!**
