import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ProductionStatus, ContractType } from '../enums';
import { User } from './User';

@Entity('productions')
export class Production {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', name: 'production_company', nullable: true })
  productionCompany: string | null;

  @Column({ type: 'text', name: 'production_designer', nullable: true })
  productionDesigner: string | null;

  @Column({ type: 'text', name: 'production_type', nullable: true })
  productionType: string | null;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Column({ type: 'text', name: 'contract_type' })
  contractType: ContractType;

  @Column({ type: 'text', default: ProductionStatus.PRE_PRODUCTION })
  status: ProductionStatus;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
