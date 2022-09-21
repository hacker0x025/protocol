/**
 * Runs the RFQM MetaTransaction Consumer
 */
import { pino } from '@0x/api-utils';
import * as Sentry from '@sentry/node';
// Workaround for Sentry tracing to work: https://github.com/getsentry/sentry-javascript/issues/4731
import '@sentry/tracing';
import { SQS } from 'aws-sdk';
import { Counter } from 'prom-client';

import {
    ChainConfiguration,
    CHAIN_CONFIGURATIONS,
    CHAIN_ID,
    META_TX_WORKER_MNEMONIC,
    RFQM_WORKER_GROUP_INDEX,
    RFQM_WORKER_GROUP_SIZE,
    SENTRY_DSN,
    SENTRY_ENVIRONMENT,
    SENTRY_TRACES_SAMPLE_RATE,
} from '../config';
import { MetaTransactionJobEntity, RfqmV2JobEntity } from '../entities';
import { getDbDataSourceAsync } from '../getDbDataSourceAsync';
import { logger } from '../logger';
import { RfqmTypes } from '../services/types';
import { WorkerService } from '../services/WorkerService';
import { ConfigManager } from '../utils/config_manager';
import { RfqmDbUtils } from '../utils/rfqm_db_utils';
import { buildWorkerServiceAsync } from '../utils/rfqm_service_builder';
import { RfqBlockchainUtils } from '../utils/rfq_blockchain_utils';
import { RfqMakerDbUtils } from '../utils/rfq_maker_db_utils';
import { RfqMakerManager } from '../utils/rfq_maker_manager';
import { startMetricsServer } from '../utils/runner_utils';
import { SqsClient } from '../utils/sqs_client';
import { SqsConsumer } from '../utils/sqs_consumer';

const RFQM_JOB_DEQUEUED = new Counter({
    name: 'rfqm_job_dequeued',
    help: 'An Rfqm Job was pulled from the queue',
    labelNames: ['address', 'chain_id'],
});

process.on(
    'uncaughtException',
    // see https://github.com/pinojs/pino/blob/master/docs/help.md#exit-logging
    pino.final(logger, (error, finalLogger) => {
        finalLogger.error(
            { errorMessage: error.message, workerGroupIndex: RFQM_WORKER_GROUP_INDEX },
            'RFQM worker group exiting due to uncaught exception',
        );
        process.exit(1);
    }),
);

process.on('unhandledRejection', (reason, promise) => {
    const finalLogger = pino.final(logger);
    let errorMessage = '';
    if (reason instanceof Error) {
        errorMessage = reason.message;
    }
    finalLogger.error(
        { errorMessage, promise, workerGroupIndex: RFQM_WORKER_GROUP_INDEX },
        'RFQM worker group exiting due to unhandled rejection',
    );
    process.exit(1);
});

if (require.main === module) {
    (async () => {
        // Start the Metrics Server
        startMetricsServer();

        // Build dependencies
        const configManager = new ConfigManager();
        const connection = await getDbDataSourceAsync();
        const rfqmDbUtils = new RfqmDbUtils(connection);
        const rfqMakerDbUtils = new RfqMakerDbUtils(connection);

        const chain = CHAIN_CONFIGURATIONS.find((c) => c.chainId === CHAIN_ID);
        if (!chain) {
            throw new Error(`Tried to start worker for chain ${CHAIN_ID}
            but no chain configuration was present`);
        }

        const rfqMakerManager = new RfqMakerManager(configManager, rfqMakerDbUtils, chain.chainId);
        await rfqMakerManager.initializeAsync();

        if (SENTRY_DSN) {
            Sentry.init({
                dsn: SENTRY_DSN,
                environment: SENTRY_ENVIRONMENT,

                // Set tracesSampleRate to 1.0 to capture 100%
                // of transactions for performance monitoring.
                // We recommend adjusting this value in production
                tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
            });
        }

        if (META_TX_WORKER_MNEMONIC === undefined) {
            throw new Error(`META_TX_WORKER_MNEMONIC must be defined to use RFQM worker runner`);
        }
        if (RFQM_WORKER_GROUP_INDEX === undefined) {
            throw new Error(`RFQM_WORKER_GROUP_INDEX must be defined to use RFQM worker runner`);
        }
        if (RFQM_WORKER_GROUP_SIZE === undefined) {
            throw new Error(`RFQM_WORKER_GROUP_SIZE must be defined to use RFQM worker runner`);
        }
        const workers: SqsConsumer[] = [];
        for (let i = 0; i < RFQM_WORKER_GROUP_SIZE; i += 1) {
            const workerIndex: number = RFQM_WORKER_GROUP_INDEX! * RFQM_WORKER_GROUP_SIZE! + i;
            const workerAddress = RfqBlockchainUtils.getAddressFromIndexAndPhrase(
                META_TX_WORKER_MNEMONIC!,
                workerIndex,
            );
            const workerService = await buildWorkerServiceAsync(rfqmDbUtils, rfqMakerManager, chain, workerIndex);
            workers.push(createGaslessSwapWorker(workerService, workerIndex, workerAddress, chain));
        }

        const consumeLoops: Promise<void>[] = workers.map(async (worker) => {
            // run the worker
            logger.info(
                { workerAddress: worker.workerAddress, workerIndex: worker.workerIndex },
                'Starting RFQM worker',
            );
            return worker.consumeAsync();
        });
        // Add SIGTERM signal handler
        process.on('SIGTERM', async () => {
            logger.info(
                { workerGroupIndex: RFQM_WORKER_GROUP_INDEX },
                'SIGTERM signal received. Stop consuming more queue messages.',
            );

            // Avoid pulling more messages from the queue
            workers.forEach((worker) => {
                worker.stop();
            });
            // Wait to finish processing current queue message
            await Promise.all(consumeLoops);
            logger.info({ workerGroupIndex: RFQM_WORKER_GROUP_INDEX }, 'Worker group has stopped consuming.');
        });

        // Wait for pulling loops
        await Promise.all(consumeLoops);
    })(); // tslint:disable-line no-floating-promises
}

/**
 * Creates gasless swap worker
 */
export function createGaslessSwapWorker(
    workerService: WorkerService,
    workerIndex: number,
    workerAddress: string,
    chain: ChainConfiguration,
): SqsConsumer {
    // Build the Sqs consumer
    const sqsClient = new SqsClient(new SQS({ apiVersion: '2012-11-05' }), chain.sqsUrl);
    const consumer = new SqsConsumer({
        workerIndex,
        workerAddress,
        sqsClient,
        beforeHandle: async () => workerService.workerBeforeLogicAsync(workerIndex, workerAddress),
        handleMessage: async (message) => {
            RFQM_JOB_DEQUEUED.labels(workerAddress, chain.chainId.toString()).inc();

            // Message body should not be empty; refine type
            if (!message.Body) {
                throw new Error('Message body should not be empty');
            }

            const messageBody = JSON.parse(message.Body);
            const type = messageBody.type as RfqmTypes;
            let identifier;
            let kind: (RfqmV2JobEntity | MetaTransactionJobEntity)['kind'];

            switch (type) {
                case RfqmTypes.OtcOrder:
                    const { orderHash } = messageBody;
                    identifier = orderHash;
                    kind = 'rfqm_v2_job';
                    break;
                case RfqmTypes.MetaTransaction:
                    const { id } = messageBody;
                    identifier = id;
                    kind = 'meta_transaction_job';
                    break;
                default:
                    ((_x: never) => {
                        throw new Error('unreachable');
                    })(type);
            }

            logger.info({ workerAddress, kind, identifier }, 'Job dequeued from SQS');
            await workerService.processJobAsync(identifier, workerAddress, kind);
        },
    });

    return consumer;
}
