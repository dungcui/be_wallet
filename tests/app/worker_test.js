const Web3 = require("web3");
const Decimal = require("decimal.js");
var assert = require('chai').assert;
var expect = require('chai').expect;

let web3;
beforeEach(function () {
    // ...some logic before each test is run
    web3 = new Web3();
    web3.setProvider(new Web3.providers.WebsocketProvider("wss://rinkeby.infura.io/ws/v3/7dfb5a7cd8414702b6704bf0b8afe897"));
})

it('get lastLog and decode transaction', async function () {
    let options = {
        fromBlock: 7137233,
        toBlock: 7137233,
        address: ['0x98989408435511a7049123F2ECc7d7C93462A3A5'],
        topics:
            ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
    }
    const block = await web3.eth.getPastLogs(options);
    // console.log("block :", block);
    assert.isArray(block, 'is array of txs');
    const decode = web3.eth.abi.decodeLog([{
        type: 'address',
        name: 'from',
        indexed: true
    }, {
        type: 'address',
        name: 'to',
        indexed: true
    }, {
        type: 'uint256',
        name: 'value'
    }],
        '0x0000000000000000000000000000000000000000000000008ac7230489e80000',
        ['0x000000000000000000000000a5025faba6e70b84f74e9b1113e5f7f4e7f4859f',
            '0x000000000000000000000000390e4cc5eaa09791c167a4b0ec9c6df598ec99df']);
    let address = "0x000000000000000000000000a5025faba6e70b84f74e9b1113e5f7f4e7f4859f";
    expect('0x' + address.substring(26))
        .to.be.a('string')
        .and.equal(decode.from.toLowerCase())
        .and.equal('0xa5025faba6e70b84f74e9b1113e5f7f4e7f4859f');
    let address2 = "0x000000000000000000000000390e4cc5eaa09791c167a4b0ec9c6df598ec99df";
    expect('0x' + address2.substring(26))
        .to.be.a('string')
        .and.equal(decode.to.toLowerCase())
        .and.equal('0x390e4cc5eaa09791c167a4b0ec9c6df598ec99df');

    let data = "0x0000000000000000000000000000000000000000000000008ac7230489e80000";
    expect(new Decimal(data).toNumber())
        .to.be.a('number')
        .and.equal(new Decimal(decode.value).toNumber());
})



it('block should have timestamps', async function () {
    const block = await web3.eth.getBlock(7137233, true);
    expect(block.timestamp);
})