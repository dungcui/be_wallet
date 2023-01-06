
class SyncBlockRepository {

    constructor({ SyncBlockModel }) {
        this.SyncBlockModel = SyncBlockModel;
    }

    async update({ service, height }) {
        return await this.SyncBlockModel.findOneAndUpdate({ service }, { height }, {
            upsert: true
        })
    }

    async get({ service }) {
        return await this.SyncBlockModel.findOne({ service });
    }

    async findByListServices(serviceNames) {
        return await this.SyncBlockModel.find(
            {
                'service': {
                    $in: serviceNames
                }
            })
    }

}

module.exports = SyncBlockRepository;