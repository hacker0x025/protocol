import { BigNumber } from '@0x/asset-swapper';
import { OtcOrderFields, Signature } from '@0x/protocol-utils';
import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { BigNumberTransformer } from './transformers';
import { RfqmJobStatus, RfqmOrderTypes, StoredFee } from './types';

export type RfqmV2JobConstructorOpts = Pick<
    RfqmV2JobEntity,
    'chainId' | 'expiry' | 'fee' | 'makerUri' | 'order' | 'orderHash'
> &
    Partial<RfqmV2JobEntity>;

export interface StoredOtcOrder {
    type: RfqmOrderTypes.Otc;
    order: StringOtcOrderFields;
}

type StringOtcOrderFields = Record<keyof OtcOrderFields, string>;

@Entity({ name: 'rfqm_v2_jobs' })
export class RfqmV2JobEntity {
    @PrimaryColumn({ name: 'order_hash', type: 'varchar' })
    public orderHash: string;

    @Index()
    @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
    public createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
    public updatedAt: Date | null;

    // The expiration time of the job, in unix seconds
    @Column({ name: 'expiry', type: 'numeric', transformer: BigNumberTransformer })
    public expiry: BigNumber;

    @Column({ name: 'chain_id', type: 'integer' })
    public chainId: number;

    @Column({ name: 'integrator_id', type: 'varchar', nullable: true })
    public integratorId: string | null;

    @Column({ name: 'maker_uri', type: 'varchar' })
    public makerUri: string;

    @Index()
    @Column({ name: 'status', type: 'varchar' })
    public status: RfqmJobStatus;

    @Column({ name: 'fee', type: 'jsonb' })
    public fee: StoredFee;

    @Column({ name: 'order', type: 'jsonb' })
    public order: StoredOtcOrder;

    @Column({ name: 'worker_address', type: 'varchar', nullable: true })
    public workerAddress: string | null;

    @Column({ name: 'last_look_result', type: 'boolean', nullable: true })
    public lastLookResult: boolean | null;

    @Column({ name: 'affiliate_address', type: 'varchar', nullable: true })
    public affiliateAddress: string | null;

    // The taker's signature of the order hash.
    // Should be deleted upon job failure or last look rejection.
    @Column({ name: 'taker_signature', type: 'jsonb', nullable: true })
    public takerSignature: Signature | null;

    // The maker's signature of the order hash.
    // Should be deleted upon job failure.
    @Column({ name: 'maker_signature', type: 'jsonb', nullable: true })
    public makerSignature: Signature | null;

    // Whether the maker wrapped native token will be unwrapped to the native token
    // when passed to the taker
    @Column({ name: 'is_unwrap', type: Boolean })
    public isUnwrap: boolean;

    // TypeORM runs a validation check where it calls this initializer with no argument.
    // With no default `opts`, `opts` will be undefined and the validation will throw,
    // therefore, add this hacky default.
    // tslint:disable-next-line no-object-literal-type-assertion
    constructor(opts: RfqmV2JobConstructorOpts = {} as RfqmV2JobConstructorOpts) {
        // allow createdAt overrides for testing
        if (opts.createdAt) {
            this.createdAt = opts.createdAt;
        }

        this.affiliateAddress = opts.affiliateAddress ?? null;
        this.chainId = opts.chainId;
        this.expiry = opts.expiry;
        this.fee = opts.fee;
        this.integratorId = opts.integratorId ?? null;
        this.isUnwrap = opts.isUnwrap ?? false;
        this.lastLookResult = opts.lastLookResult ?? null;
        this.makerSignature = opts.makerSignature ?? null;
        this.makerUri = opts.makerUri;
        this.order = opts.order;
        this.orderHash = opts.orderHash;
        this.status = opts.status ?? RfqmJobStatus.PendingEnqueued;
        this.takerSignature = opts.takerSignature ?? null;
        this.updatedAt = opts.updatedAt ?? null;
        this.workerAddress = opts.workerAddress ?? null;
    }
}
