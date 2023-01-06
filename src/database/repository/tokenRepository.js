
class TokenRepository {

    constructor({ TokenModel }) {
        this.TokenModel = TokenModel;
        this.tokens = [];
    }

    async create({ service, contractAddress, symbol, decimals, enabled }) {
        return await this.TokenModel.create({ service, contractAddress, symbol, decimals, enabled });
    }


    async preload(service) {
        this.tokens = await this.TokenModel.find({ service, enabled: true })
    }

    async findContractByAddressAndService({ service, contractAddress }) {
        return await this.TokenModel.findOne({ service, contractAddress })
    }

    async find({ service, contractAddress }) {
        return await this.TokenModel.findOne({ service, contractAddress })
    }

    async update({ service, contractAddress, symbol, decimals, enabled }) {
        return await this.TokenModel.findOneAndUpdate({ service, contractAddress, symbol, decimals, enabled })
    }

    async getAll(service) {
        return await this.TokenModel.find({ service, enabled: true })
    }

    async isEnabled({ service, contractAddress, symbol }) {
        const token = await this.TokenModel.findOne({ service, contractAddress, symbol, enabled: true });
        return (token && token.enabled)
    }
    async getArrayContractAddress({ service }) {
        const tokens = await this.TokenModel.find({ service, enabled: true })
        return tokens.map(token => token.contractAddress);
    }

    async findByServiceAndSymbol({ service, symbol }) {
        return await this.TokenModel.findOne({ service, symbol })
    }
}

module.exports = TokenRepository;