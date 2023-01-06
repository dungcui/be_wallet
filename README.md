- **Deposit:** The service will listen from network for funding events from users to exchange, then create a balance hash to push to message queue. All messages follow the same format regardless to the currencies.
- **Withdrawal:** The service will create a unsigned transaction file, which need to be signed by a sign tool. The signed file will be broadcasted by the service too after that.
- **Settlement:** For some currencies, like Ethereum, the crypto assets from funding need to transfer to one address for withdrawal, the service provides ability to bundle these transactions for signing as the same as Withdrawal.

## Requirements

1. Install Docker/docker-compose CE

2. Install Node>=10.22.0 (for development)

3. Prepare docker-compose.yml

## Local development

1. Prepare environment 
   `` shell
   cp .env.example .env


2. Build wallet service app

   ```shell
   docker-compose build 
   ```
3. Set lastedblock in docker-compose.yml ( mainnet at production/ testnet at development )
   ETH_START_BLOCK_HEIGHT
   
4. Run service app 
   ```shell
   docker-compose up -d
   ```

