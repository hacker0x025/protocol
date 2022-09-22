import axios from 'axios';
import { Job, Queue } from 'bullmq';
import { Gauge } from 'prom-client';

import { INTEGRATORS_ACL } from '../config';
import { logger } from '../logger';

import { BackgroundJobBlueprint } from './blueprint';

// ,' ,  ,` '  ,'╭╮','╭╮╭┳┳╮, '  ` ' ,,`╭┳╮' `, '
// ,'  _ , ', ,╭╮┣╋━┳┳╋╋╯┣┫╰┳┳╮╭━━┳━┳━┳╋┫╰┳━┳┳╮
//  , o\`.  , '┃╰┫┃╋┃┃┃┃╋┃┃╭┫┃┃┃┃┃┃╋┃┃┃┃┃╭┫╋┃╭╯
// ',' +/\| , ,╰━┻┻╮┣━┻┻━┻┻━╋╮┃╰┻┻┻━┻┻━┻┻━┻━┻╯
// ,   |\  ,'' ,',`╰╯'`  , ,`╰━╯ '  , `  ` , ` '

/**
 * The liquidity monitor runs periodically to create a history
 * of liquity being served by 0x products.
 */

const QUEUE_NAME = 'liquidity-monitor';
const REMOVE_ON_COMPLETE_OPS = {
    count: 10,
};
const REMOVE_ON_FAILURE_OPS = {
    count: 10,
};
const SCHEDULE = '*/5 * * * *'; // job will be scheduled at every 5 minutes
const DESCRIPTION = 'Makes requests to 0x API endpoints and logs the results of\
available liquidity to Prometheus';

export interface BackgroundJobLiquidityMonitorData {
    timestamp: number;
}

export interface BackgroundJobLiquidityMonitorResult {
    jobName: string;
    timestamp: number;
}

const backgroundJobLiquidityMonitor: BackgroundJobBlueprint<
    BackgroundJobLiquidityMonitorData,
    BackgroundJobLiquidityMonitorResult
> = {
    queueName: QUEUE_NAME,
    schedule: SCHEDULE,
    description: DESCRIPTION,
    createAsync,
    processAsync,
};
// tslint:disable-next-line: no-default-export
export default backgroundJobLiquidityMonitor;

/**
 * The status of a liquidity request.
 *
 * In grafana, these integers can be mapped to names and colors
 * in the State Timeline graph -> Value mappings panel.
 */
enum Status {
    Fail = 0,
    NoLiquidityAvailable,
    LiquidityAvailable,
}

const LIQUIDITY_MONITOR_GAUGE = new Gauge({
    name: 'liquidity_monitor_gauge',
    labelNames: [
        'pair',
        'source', // can be specific market maker or product, i.e. zero/g, rfqm, etc.
        'chain_id',
    ],
    help: 'Gauge indicating whether liquidity is available for the pair/source/chain combination',
});

/**
 * Pushes a liquidity monitor job to the work queue.
 */
async function createAsync(
    queue: Queue,
    data: BackgroundJobLiquidityMonitorData,
): Promise<Job<BackgroundJobLiquidityMonitorData, BackgroundJobLiquidityMonitorResult>> {
    logger.info({ queue: QUEUE_NAME, data }, 'Creating a liquidity monitor job on queue');
    return queue.add(`${QUEUE_NAME}.${data.timestamp}`, data, {
        removeOnComplete: REMOVE_ON_COMPLETE_OPS,
        removeOnFail: REMOVE_ON_FAILURE_OPS,
    });
}

/**
 * The logic that runs to check liquidity and update the gauge.
 */
async function processAsync(
    job: Job<BackgroundJobLiquidityMonitorData, BackgroundJobLiquidityMonitorResult>,
): Promise<BackgroundJobLiquidityMonitorResult> {
    const devApiKey = INTEGRATORS_ACL.find((i) => i.label === '0x Internal')?.apiKeys[0];
    if (!devApiKey) {
        throw new Error('[liquidity montior] Unable to get API key');
    }

    const axiosInstance = axios.create({ headers: { '0x-api-key': devApiKey } });

    await job.updateProgress(0);
    logger.info(
        { jobName: job.name, queue: job.queueName, data: job.data, timestamp: Date.now() },
        'Processing liquidity monitor job',
    );

    // Starting off simple here with a handcoded check of RFQm and zero/g polygon WMATIC->USDC
    // Later, we can add more pairs and more sources.
    const wmaticPolygon = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
    const usdcPowPolygon = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

    [
        { source: 'rfqm', url: 'https://polygon.api.0x.org/rfqm/v1/quote' },
        { source: 'zero/g', url: 'https://polygon.api.0x.org/zero-gas/swap/v1/quote' },
    ].forEach(async ({ source, url }) => {
        try {
            const { data: response } = await axiosInstance.get<{ liquidityAvailable: boolean }>(url, {
                params: {
                    buyToken: wmaticPolygon,
                    sellToken: usdcPowPolygon,
                    buyAmount: '1000000',
                    takerAddress: '0x4Ea754349AcE5303c82f0d1D491041e042f2ad22',
                },
                headers: {
                    '0x-chain-id': '137',
                },
            });
            if (!response.hasOwnProperty('liquidityAvailable')) {
                throw new Error('Malformed response');
            }
            const { liquidityAvailable: isLiquidityAvailable } = response;
            LIQUIDITY_MONITOR_GAUGE.labels('WMATIC-USDC', source, '137').set(
                isLiquidityAvailable ? Status.LiquidityAvailable : Status.NoLiquidityAvailable,
            );
        } catch (e) {
            const errorJson = axios.isAxiosError(e) ? e.toJSON() : null;
            logger.error({ message: e.message, axiosErrorJson: errorJson }, 'Liquidity check failed');
            LIQUIDITY_MONITOR_GAUGE.labels('WMATIC-USDC', source, '137').set(Status.Fail);
        }
    });

    // tslint:disable-next-line: custom-no-magic-numbers
    await job.updateProgress(100);
    return {
        jobName: job.name,
        timestamp: Date.now(),
    };
}
