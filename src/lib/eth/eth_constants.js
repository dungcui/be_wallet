module.exports = {
    NAME: 'ETH',
    CURRENCY: 'ETH',
    FEE_CURRENCY: 'ETH',
    bip44Prefix: "m/44'/60'/0'/",
    ERC20_TOPICS: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    BASE_FEE: 0.000021,
    ABI: [{
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
    BASE_FEE: 0.000021,
    ETH_TO_GWEI: 1000000000,
    ETH_TO_WEI: 1000000000000000000,
    GROSS_GAS_LIMIT: 21000,
};
