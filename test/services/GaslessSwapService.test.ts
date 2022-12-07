// tslint:disable: max-file-line-count
import { ValidationError, ValidationErrorCodes } from '@0x/api-utils';
import { AssetSwapperContractAddresses as ContractAddresses, SupportedProvider } from '@0x/asset-swapper';
import { ethSignHashWithKey, MetaTransaction, OtcOrder, SignatureType } from '@0x/protocol-utils';
import { BigNumber } from '@0x/utils';
import { AxiosInstance } from 'axios';
import { providers } from 'ethers';
import Redis from 'ioredis';
import { Producer } from 'sqs-producer';
import { Connection } from 'typeorm';

import { Integrator } from '../../src/config';
import { ZERO } from '../../src/core/constants';
import { MetaTransactionJobEntity } from '../../src/entities';
import { RfqmJobStatus } from '../../src/entities/types';
import { GaslessSwapService } from '../../src/services/GaslessSwapService';
import { FeeService } from '../../src/services/fee_service';
import { RfqmService } from '../../src/services/rfqm_service';
import { RfqMakerBalanceCacheService } from '../../src/services/rfq_maker_balance_cache_service';
import {
    ApprovalResponse,
    FetchIndicativeQuoteResponse,
    OtcOrderRfqmQuoteResponse,
    RfqmTypes,
} from '../../src/services/types';
import { BalanceChecker } from '../../src/utils/balance_checker';
import { CacheClient } from '../../src/utils/cache_client';
import { getQuoteAsync } from '../../src/utils/MetaTransactionClient';
import { QuoteServerClient } from '../../src/utils/quote_server_client';
import { RfqmDbUtils } from '../../src/utils/rfqm_db_utils';
import { RfqBlockchainUtils } from '../../src/utils/rfq_blockchain_utils';
import { RfqMakerManager } from '../../src/utils/rfq_maker_manager';
import { TokenMetadataManager } from '../../src/utils/TokenMetadataManager';

jest.mock('../../src/services/rfqm_service', () => {
    return {
        RfqmService: jest.fn().mockImplementation(() => {
            return {
                fetchFirmQuoteAsync: jest.fn(),
                fetchIndicativeQuoteAsync: jest.fn(),
                getGaslessApprovalResponseAsync: jest.fn(),
            };
        }),
    };
});

jest.mock('../../src/utils/MetaTransactionClient', () => {
    return {
        getQuoteAsync: jest.fn(),
    };
});

jest.mock('../../src/utils/rfq_blockchain_utils', () => {
    return {
        RfqBlockchainUtils: jest.fn().mockImplementation(() => {
            return {
                getTokenBalancesAsync: jest.fn(),
                getMinOfBalancesAndAllowancesAsync: jest.fn(),
                getExchangeProxyAddress: jest.fn(),
            };
        }),
    };
});

jest.mock('../../src/utils/rfqm_db_utils', () => {
    return {
        RfqmDbUtils: jest.fn().mockImplementation(() => {
            return {
                findMetaTransactionJobsWithStatusesAsync: jest.fn().mockResolvedValue([]),
                writeMetaTransactionJobAsync: jest.fn(),
            };
        }),
    };
});

jest.mock('ioredis', () => {
    return {
        default: jest.fn().mockImplementation(() => {
            return {
                set: jest.fn(),
                get: jest.fn(),
            };
        }),
    };
});

jest.mock('sqs-producer', () => {
    return {
        Producer: jest.fn().mockImplementation(() => {
            return {
                send: jest.fn(),
            };
        }),
    };
});

// tslint:disable: no-object-literal-type-assertion
const getMetaTransactionQuoteAsyncMock = getQuoteAsync as jest.Mock<
    ReturnType<typeof getQuoteAsync>,
    Parameters<typeof getQuoteAsync>
>;
const mockSqsProducer = jest.mocked(new Producer({}));
const mockDbUtils = jest.mocked(new RfqmDbUtils({} as Connection));
const mockBlockchainUtils = jest.mocked(
    new RfqBlockchainUtils({} as SupportedProvider, '0xdefi', {} as BalanceChecker, {} as providers.JsonRpcProvider),
);

const mockRfqmService = jest.mocked(
    new RfqmService(
        0,
        {} as FeeService,
        0,
        {} as ContractAddresses,
        '0x0',
        {} as RfqBlockchainUtils,
        {} as RfqmDbUtils,
        {} as Producer,
        {} as QuoteServerClient,
        {} as CacheClient,
        {} as RfqMakerBalanceCacheService,
        {} as RfqMakerManager,
        {} as TokenMetadataManager,
    ),
);

const mockRedis = jest.mocked(new Redis());

const gaslessSwapService = new GaslessSwapService(
    /* chainId */ 1337, // tslint:disable-line: custom-no-magic-numbers
    mockRfqmService,
    new URL('https://hokiesports.com/quote'),
    {} as AxiosInstance,
    mockRedis,
    mockDbUtils,
    mockBlockchainUtils,
    mockSqsProducer,
);

describe('GaslessSwapService', () => {
    const takerPrivateKey = '0xd2c2349e10170e4219d9febd1c663ea5c7334f79c38d25f4f52c85af796c7c05';
    const metaTransaction = new MetaTransaction({
        callData:
            '0x415565b00000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000017b9e2a304f00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000860000000000000000000000000000000000000000000000000000000000000086000000000000000000000000000000000000000000000000000000000000007c000000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000002517569636b5377617000000000000000000000000000000000000000000000000000000000000008570b55cfac18858000000000000000000000000000000000000000000000000000000039d0b9efd1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000002517569636b53776170000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001c94ebec37000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000b446f646f5632000000000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001db5156c13000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000400000000000000000000000005333eb1e32522f1893b7c9fea3c263807a02d561000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000012556e69737761705633000000000000000000000000000000000000000000000000000000000000190522016f044a05b0000000000000000000000000000000000000000000000000000000b08217af9400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000060000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012556e697377617056330000000000000000000000000000000000000000000000000000000000000c829100b78224ef50000000000000000000000000000000000000000000000000000000570157389f000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000427ceb23fd6bc0add59e62ac25578270cff1b9f6190001f41bfd67037b42cf73acf2047067bd4f2c47d9bfd6000bb82791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000869584cd0000000000000000000000008c611defbd838a13de3a5923693c58a7c1807c6300000000000000000000000000000000000000000000005b89d96b4863067a6b',
        chainId: 137,
        verifyingContract: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
        expirationTimeSeconds: new BigNumber('9990868679'),
        feeAmount: new BigNumber(0),
        feeToken: '0x0000000000000000000000000000000000000000',
        maxGasPrice: new BigNumber(4294967296),
        minGasPrice: new BigNumber(1),
        // $eslint-fix-me https://github.com/rhinodavid/eslint-fix-me
        // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
        salt: new BigNumber(32606650794224189614795510724011106220035660490560169776986607186708081701146),
        sender: '0x0000000000000000000000000000000000000000',
        signer: '0x4c42a706410f1190f97d26fe3c999c90070aa40f',
        value: new BigNumber(0),
    });
    const price: FetchIndicativeQuoteResponse = {
        allowanceTarget: '0x12345',
        buyAmount: new BigNumber(1800054805473),
        sellAmount: new BigNumber(1000000000000000000000),
        buyTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        sellTokenAddress: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
        gas: new BigNumber(1043459),
        price: new BigNumber(1800.054805),
    };
    // $eslint-fix-me https://github.com/rhinodavid/eslint-fix-me
    // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
    const expiry = new BigNumber(9999999999999999); // tslint:disable-line custom-no-magic-numbers
    const otcOrder = new OtcOrder({
        txOrigin: '0x0000000000000000000000000000000000000000',
        taker: '0x1111111111111111111111111111111111111111',
        maker: '0x2222222222222222222222222222222222222222',
        makerToken: '0x3333333333333333333333333333333333333333',
        takerToken: '0x4444444444444444444444444444444444444444',
        expiryAndNonce: OtcOrder.encodeExpiryAndNonce(expiry, ZERO, expiry),
        chainId: 1337,
        verifyingContract: '0x0000000000000000000000000000000000000000',
    });
    const otcQuote: OtcOrderRfqmQuoteResponse = {
        allowanceTarget: '0x12345',
        buyAmount: new BigNumber(1800054805473),
        sellAmount: new BigNumber(1000000000000000000000),
        buyTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        sellTokenAddress: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
        gas: new BigNumber(1043459),
        price: new BigNumber(1800.054805),
        type: RfqmTypes.OtcOrder,
        order: otcOrder,
        orderHash: otcOrder.getHash(),
    };

    beforeEach(() => {
        mockBlockchainUtils.getExchangeProxyAddress.mockReturnValue('0x12345');
        jest.clearAllMocks();
    });

    describe('fetchPriceAsync', () => {
        it('gets an RFQ price if available', async () => {
            mockRfqmService.fetchIndicativeQuoteAsync.mockResolvedValueOnce(price);

            const result = await gaslessSwapService.fetchPriceAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
            });

            expect(result?.liquiditySource).toEqual('rfq');
            expect(result).toMatchInlineSnapshot(`
                Object {
                  "allowanceTarget": "0x12345",
                  "buyAmount": "1800054805473",
                  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                  "gas": "1043459",
                  "liquiditySource": "rfq",
                  "price": "1800.054805",
                  "sellAmount": "1000000000000000000000",
                  "sellTokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
                }
            `);
            expect(getMetaTransactionQuoteAsyncMock).not.toBeCalled();
        });

        it('gets an AMM price if no RFQ liquidity is available', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchIndicativeQuoteAsync.mockResolvedValueOnce(null);

            const result = await gaslessSwapService.fetchPriceAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
            });

            expect(result?.liquiditySource).toEqual('amm');
            expect(result).toMatchInlineSnapshot(`
                Object {
                  "allowanceTarget": "0x12345",
                  "buyAmount": "1800054805473",
                  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                  "gas": "1043459",
                  "liquiditySource": "amm",
                  "price": "1800.054805",
                  "sellAmount": "1000000000000000000000",
                  "sellTokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
                }
            `);
        });

        it('gets an AMM price if RFQ request throws', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchIndicativeQuoteAsync.mockImplementationOnce(() => {
                throw new Error('rfqm quote threw up');
            });

            const result = await gaslessSwapService.fetchPriceAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
            });

            expect(result?.liquiditySource).toEqual('amm');
            expect(result).toMatchInlineSnapshot(`
                Object {
                  "allowanceTarget": "0x12345",
                  "buyAmount": "1800054805473",
                  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                  "gas": "1043459",
                  "liquiditySource": "amm",
                  "price": "1800.054805",
                  "sellAmount": "1000000000000000000000",
                  "sellTokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
                }
            `);
        });

        it('returns `null` if no liquidity is available', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce(null);
            mockRfqmService.fetchIndicativeQuoteAsync.mockResolvedValueOnce(null);

            const result = await gaslessSwapService.fetchPriceAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
            });

            expect(result).toBeNull();
        });

        it('throws if AMM request throws and RFQ has no liquidity / request throws', async () => {
            mockRfqmService.fetchIndicativeQuoteAsync.mockImplementationOnce(() => {
                throw new Error('rfqm price threw up');
            });
            getMetaTransactionQuoteAsyncMock.mockImplementationOnce(() => {
                throw new Error('amm price threw up');
            });

            await expect(() =>
                gaslessSwapService.fetchPriceAsync({
                    buyAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                }),
            ).rejects.toThrow('Error fetching price');
        });

        it('throws validation error if AMM quote throws validation error', async () => {
            getMetaTransactionQuoteAsyncMock.mockImplementation(() => {
                throw new ValidationError([
                    {
                        field: 'sellAmount',
                        code: ValidationErrorCodes.FieldInvalid,
                        reason: 'sellAmount too small',
                    },
                ]);
            });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValue({ quote: null, quoteReportId: null });

            await expect(() =>
                gaslessSwapService.fetchPriceAsync({
                    buyAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                    takerAddress: '0xtaker',
                }),
            ).rejects.toThrow(ValidationError);

            await expect(() =>
                gaslessSwapService.fetchPriceAsync({
                    sellAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                    takerAddress: '0xtaker',
                }),
            ).rejects.toThrow(ValidationError);
        });
    });
    describe('fetchQuoteAsync', () => {
        it('gets an RFQ quote if available', async () => {
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: otcQuote, quoteReportId: null });

            const result = await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });

            expect(result).not.toBeNull();
            expect(result?.type).toEqual(RfqmTypes.OtcOrder);
            expect(result).toMatchInlineSnapshot(`
                Object {
                  "allowanceTarget": "0x12345",
                  "buyAmount": "1800054805473",
                  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                  "gas": "1043459",
                  "liquiditySource": "rfq",
                  "order": OtcOrder {
                    "chainId": 1337,
                    "expiry": "10000000000000000",
                    "expiryAndNonce": "62771017353866807638357894232076664161023554444640345128970000000000000000",
                    "maker": "0x2222222222222222222222222222222222222222",
                    "makerAmount": "0",
                    "makerToken": "0x3333333333333333333333333333333333333333",
                    "nonce": "10000000000000000",
                    "nonceBucket": "0",
                    "taker": "0x1111111111111111111111111111111111111111",
                    "takerAmount": "0",
                    "takerToken": "0x4444444444444444444444444444444444444444",
                    "txOrigin": "0x0000000000000000000000000000000000000000",
                    "verifyingContract": "0x0000000000000000000000000000000000000000",
                  },
                  "orderHash": "0x69b784087387d37e2361a40146420a5a68b08375238a5ba0329f612d5673b2ea",
                  "price": "1800.054805",
                  "sellAmount": "1000000000000000000000",
                  "sellTokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
                  "type": "otc",
                }
            `);
            expect(getMetaTransactionQuoteAsyncMock).not.toBeCalled();
        });

        it('gets an AMM quote if no RFQ liquidity is available', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });

            const result = await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });

            expect(result).not.toBeNull();
            expect(result?.type).toEqual(RfqmTypes.MetaTransaction);
            if (result?.type !== RfqmTypes.MetaTransaction) {
                // Refine type for further assertions
                throw new Error('Result should be a meta transaction');
            }
            expect(result.metaTransaction.getHash()).toEqual(metaTransaction.getHash());
            expect(result).toMatchInlineSnapshot(`
                Object {
                  "allowanceTarget": "0x12345",
                  "approval": undefined,
                  "buyAmount": "1800054805473",
                  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                  "gas": "1043459",
                  "liquiditySource": "amm",
                  "metaTransaction": MetaTransaction {
                    "callData": "0x415565b00000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000017b9e2a304f00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000860000000000000000000000000000000000000000000000000000000000000086000000000000000000000000000000000000000000000000000000000000007c000000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000002517569636b5377617000000000000000000000000000000000000000000000000000000000000008570b55cfac18858000000000000000000000000000000000000000000000000000000039d0b9efd1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000002517569636b53776170000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001c94ebec37000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000b446f646f5632000000000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001db5156c13000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000400000000000000000000000005333eb1e32522f1893b7c9fea3c263807a02d561000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000012556e69737761705633000000000000000000000000000000000000000000000000000000000000190522016f044a05b0000000000000000000000000000000000000000000000000000000b08217af9400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000060000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012556e697377617056330000000000000000000000000000000000000000000000000000000000000c829100b78224ef50000000000000000000000000000000000000000000000000000000570157389f000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000427ceb23fd6bc0add59e62ac25578270cff1b9f6190001f41bfd67037b42cf73acf2047067bd4f2c47d9bfd6000bb82791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000869584cd0000000000000000000000008c611defbd838a13de3a5923693c58a7c1807c6300000000000000000000000000000000000000000000005b89d96b4863067a6b",
                    "chainId": 137,
                    "expirationTimeSeconds": "9990868679",
                    "feeAmount": "0",
                    "feeToken": "0x0000000000000000000000000000000000000000",
                    "maxGasPrice": "4294967296",
                    "minGasPrice": "1",
                    "salt": "32606650794224190000000000000000000000000000000000000000000000000000000000000",
                    "sender": "0x0000000000000000000000000000000000000000",
                    "signer": "0x4c42a706410f1190f97d26fe3c999c90070aa40f",
                    "value": "0",
                    "verifyingContract": "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
                  },
                  "metaTransactionHash": "0xde5a11983edd012047dd3107532f007a73ae488bfb354f35b8a40580e2a775a1",
                  "price": "1800.054805",
                  "sellAmount": "1000000000000000000000",
                  "sellTokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
                  "type": "metatransaction",
                }
            `);
        });

        it('throws validation error if AMM quote throws validation error', async () => {
            getMetaTransactionQuoteAsyncMock.mockImplementation(() => {
                throw new ValidationError([
                    {
                        field: 'sellAmount',
                        code: ValidationErrorCodes.FieldInvalid,
                        reason: 'sellAmount too small',
                    },
                ]);
            });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValue({ quote: null, quoteReportId: null });

            await expect(() =>
                gaslessSwapService.fetchQuoteAsync({
                    buyAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                    takerAddress: '0xtaker',
                    checkApproval: false,
                }),
            ).rejects.toThrow(ValidationError);

            await expect(() =>
                gaslessSwapService.fetchQuoteAsync({
                    sellAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                    takerAddress: '0xtaker',
                    checkApproval: false,
                }),
            ).rejects.toThrow(ValidationError);
        });

        it('adds an affiliate address if one is included in the integrator configuration but not in the quote request', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });

            await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: { affiliateAddress: '0xaffiliateAddress' } as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });
            expect(getMetaTransactionQuoteAsyncMock.mock.calls[0][/* params */ 2]['affiliateAddress']).toEqual(
                '0xaffiliateAddress',
            );
        });

        it('uses the affiliate address in the quote request even if one is present in integrator configuration', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });

            await gaslessSwapService.fetchQuoteAsync({
                affiliateAddress: '0xaffiliateAddressShouldUse',
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: { affiliateAddress: '0xaffiliateAddressShouldntUse' } as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });
            expect(getMetaTransactionQuoteAsyncMock.mock.calls[0][/* params */ 2]['affiliateAddress']).toEqual(
                '0xaffiliateAddressShouldUse',
            );
        });

        it('returns `null` if no liquidity is available', async () => {
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce(null);

            const result = await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });

            expect(result).toBeNull();
        });

        it('throws if AMM request throws and RFQ has no liquidity / request throws', async () => {
            mockRfqmService.fetchFirmQuoteAsync.mockImplementationOnce(() => {
                throw new Error('rfqm price threw up');
            });
            getMetaTransactionQuoteAsyncMock.mockImplementationOnce(() => {
                throw new Error('amm price threw up');
            });

            await expect(() =>
                gaslessSwapService.fetchQuoteAsync({
                    buyAmount: new BigNumber(1800054805473),
                    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    buyTokenDecimals: 6,
                    integrator: {} as Integrator,
                    sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                    sellTokenDecimals: 18,
                    takerAddress: '0xtaker',
                    checkApproval: false,
                }),
            ).rejects.toThrow('Error fetching quote');
        });

        it('stores a metatransaction hash', async () => {
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });

            await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: false,
            });

            expect(mockRedis.set).toBeCalledWith(`metaTransactionHash.${metaTransaction.getHash()}`, 0, 'EX', 900);
        });

        it('gets the approval object', async () => {
            const approvalResponse: ApprovalResponse = {
                isRequired: true,
            };
            getMetaTransactionQuoteAsyncMock.mockResolvedValueOnce({ metaTransaction, price });
            mockRfqmService.fetchFirmQuoteAsync.mockResolvedValueOnce({ quote: null, quoteReportId: null });
            mockRfqmService.getGaslessApprovalResponseAsync.mockResolvedValueOnce(approvalResponse);

            const result = await gaslessSwapService.fetchQuoteAsync({
                buyAmount: new BigNumber(1800054805473),
                buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                buyTokenDecimals: 6,
                integrator: {} as Integrator,
                sellToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
                sellTokenDecimals: 18,
                takerAddress: '0xtaker',
                checkApproval: true,
            });

            expect(result?.approval).not.toBeUndefined();
        });
    });
    describe('processSubmitAsync', () => {
        it('fails if the metatransaction is expired', async () => {
            const expiredMetaTransaction = new MetaTransaction({
                callData:
                    '0x415565b00000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000017b9e2a304f00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000860000000000000000000000000000000000000000000000000000000000000086000000000000000000000000000000000000000000000000000000000000007c000000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000002517569636b5377617000000000000000000000000000000000000000000000000000000000000008570b55cfac18858000000000000000000000000000000000000000000000000000000039d0b9efd1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000002517569636b53776170000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001c94ebec37000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000a5e0829caced8ffdd4de3c43696c57f7d7a678ff000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000b446f646f5632000000000000000000000000000000000000000000000000000000000000000000042b85aae7d60c42c00000000000000000000000000000000000000000000000000000001db5156c13000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000400000000000000000000000005333eb1e32522f1893b7c9fea3c263807a02d561000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000012556e69737761705633000000000000000000000000000000000000000000000000000000000000190522016f044a05b0000000000000000000000000000000000000000000000000000000b08217af9400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000060000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012556e697377617056330000000000000000000000000000000000000000000000000000000000000c829100b78224ef50000000000000000000000000000000000000000000000000000000570157389f000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000427ceb23fd6bc0add59e62ac25578270cff1b9f6190001f41bfd67037b42cf73acf2047067bd4f2c47d9bfd6000bb82791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000020000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000869584cd0000000000000000000000008c611defbd838a13de3a5923693c58a7c1807c6300000000000000000000000000000000000000000000005b89d96b4863067a6b',
                chainId: 137,
                verifyingContract: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
                expirationTimeSeconds: new BigNumber('420'),
                feeAmount: new BigNumber(0),
                feeToken: '0x0000000000000000000000000000000000000000',
                maxGasPrice: new BigNumber(4294967296),
                minGasPrice: new BigNumber(1),
                // $eslint-fix-me https://github.com/rhinodavid/eslint-fix-me
                // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
                salt: new BigNumber(32606650794224189614795510724011106220035660490560169776986607186708081701146),
                sender: '0x0000000000000000000000000000000000000000',
                signer: '0x4C42a706410F1190f97D26Fe3c999c90070aa40F',
                value: new BigNumber(0),
            });

            await expect(() =>
                gaslessSwapService.processSubmitAsync(
                    {
                        kind: RfqmTypes.MetaTransaction,
                        trade: {
                            metaTransaction: expiredMetaTransaction,
                            type: RfqmTypes.MetaTransaction,
                            signature: {
                                r: '',
                                s: '',
                                signatureType: SignatureType.EthSign,
                                v: 1,
                            },
                        },
                    },

                    'integratorId',
                ),
            ).rejects.toThrowError(ValidationError);
        });

        it("fails if the metatransaction hash doesn't exist in the redis store", async () => {
            mockRedis.get = jest.fn().mockResolvedValueOnce(null);
            await expect(() =>
                gaslessSwapService.processSubmitAsync(
                    {
                        kind: RfqmTypes.MetaTransaction,
                        trade: {
                            metaTransaction,
                            type: RfqmTypes.MetaTransaction,
                            signature: {
                                r: '',
                                s: '',
                                signatureType: SignatureType.EthSign,
                                v: 1,
                            },
                        },
                    },
                    'integratorId',
                ),
            ).rejects.toThrowError('MetaTransaction hash not found');
            expect(mockRedis.get).toBeCalledWith(`metaTransactionHash.${metaTransaction.getHash()}`);
        });

        it('fails if there is already a pending transaction for the taker/taker token', async () => {
            mockRedis.get = jest.fn().mockResolvedValueOnce({});
            mockDbUtils.findMetaTransactionJobsWithStatusesAsync.mockResolvedValueOnce([
                new MetaTransactionJobEntity({
                    chainId: 1337,
                    expiry: metaTransaction.expirationTimeSeconds,
                    fee: {
                        amount: metaTransaction.feeAmount,
                        token: metaTransaction.feeToken,
                        type: 'fixed',
                    },
                    inputToken: price.sellTokenAddress,
                    inputTokenAmount: price.sellAmount,
                    integratorId: 'integrator-id',
                    metaTransaction,
                    metaTransactionHash: '0xotherhash',
                    minOutputTokenAmount: new BigNumber(0),
                    outputToken: price.buyTokenAddress,
                    status: RfqmJobStatus.PendingProcessing,
                    takerAddress: metaTransaction.signer,
                    takerSignature: {
                        r: '',
                        s: '',
                        signatureType: SignatureType.EthSign,
                        v: 1,
                    },
                }),
            ]);
            await expect(() =>
                gaslessSwapService.processSubmitAsync(
                    {
                        kind: RfqmTypes.MetaTransaction,
                        trade: {
                            metaTransaction,
                            type: RfqmTypes.MetaTransaction,
                            signature: ethSignHashWithKey(metaTransaction.getHash(), takerPrivateKey),
                        },
                    },
                    'integratorId',
                ),
            ).rejects.toThrowError('pending trade');
        });

        it('fails if the signature is invalid', async () => {
            const otherPrivateKey = '0xae4536e2cdee8f32adc77ebe86977a01c6526a32eee7c4c2ccfb1d5ddcddaaa2';
            mockRedis.get = jest.fn().mockResolvedValueOnce({});
            mockDbUtils.findMetaTransactionJobsWithStatusesAsync.mockResolvedValueOnce([]);
            await expect(() =>
                gaslessSwapService.processSubmitAsync(
                    {
                        kind: RfqmTypes.MetaTransaction,
                        trade: {
                            metaTransaction,
                            type: RfqmTypes.MetaTransaction,
                            signature: ethSignHashWithKey(metaTransaction.getHash(), otherPrivateKey),
                        },
                    },
                    'integratorId',
                ),
            ).rejects.toThrow(ValidationError);
        });

        it('fails if taker balance is too low', async () => {
            mockRedis.get = jest.fn().mockResolvedValueOnce({});
            mockBlockchainUtils.getMinOfBalancesAndAllowancesAsync.mockResolvedValueOnce([new BigNumber(21)]);
            await expect(() =>
                gaslessSwapService.processSubmitAsync(
                    {
                        kind: RfqmTypes.MetaTransaction,
                        trade: {
                            metaTransaction,
                            type: RfqmTypes.MetaTransaction,
                            signature: ethSignHashWithKey(metaTransaction.getHash(), takerPrivateKey),
                        },
                    },
                    'integratorId',
                ),
            ).rejects.toThrow(ValidationError);
        });

        it('creates a metatransaction job', async () => {
            mockRedis.get = jest.fn().mockResolvedValueOnce({});
            mockBlockchainUtils.getMinOfBalancesAndAllowancesAsync = jest
                .fn()
                .mockResolvedValueOnce([price.sellAmount]);

            mockDbUtils.writeMetaTransactionJobAsync.mockResolvedValueOnce({ id: 'id' } as MetaTransactionJobEntity);

            const result = await gaslessSwapService.processSubmitAsync(
                {
                    kind: RfqmTypes.MetaTransaction,
                    trade: {
                        metaTransaction,
                        type: RfqmTypes.MetaTransaction,
                        signature: ethSignHashWithKey(metaTransaction.getHash(), takerPrivateKey),
                    },
                },
                'integratorId',
            );

            expect(result.metaTransactionHash).toEqual(metaTransaction.getHash());
            expect(result.type).toEqual(RfqmTypes.MetaTransaction);
            // tslint:disable-next-line: no-unbound-method
            expect(mockSqsProducer.send).toHaveBeenCalledWith({
                body: '{"id":"id","type":"metatransaction"}',
                deduplicationId: 'id',
                groupId: 'id',
                id: 'id',
            });
        });
    });
});
