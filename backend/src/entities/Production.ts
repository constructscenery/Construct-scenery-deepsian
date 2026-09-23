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

  @Column({ type: 'text', name: 'supervising_art_director', nullable: true })
  supervisingArtDirector: string | null;

  @Column({ type: 'text', name: 'supervising_art_director_mobile', nullable: true })
  supervisingArtDirectorMobile: string | null;

  @Column({ type: 'text', name: 'supervising_art_director_email', nullable: true })
  supervisingArtDirectorEmail: string | null;

  @Column({ type: 'text', name: 'financial_controller', nullable: true })
  financialController: string | null;

  @Column({ type: 'text', name: 'financial_controller_mobile', nullable: true })
  financialControllerMobile: string | null;

  @Column({ type: 'text', name: 'financial_controller_email', nullable: true })
  financialControllerEmail: string | null;

  @Column({ type: 'text', name: 'art_dept_coordinator', nullable: true })
  artDeptCoordinator: string | null;

  @Column({ type: 'text', name: 'art_dept_coordinator_mobile', nullable: true })
  artDeptCoordinatorMobile: string | null;

  @Column({ type: 'text', name: 'art_dept_coordinator_email', nullable: true })
  artDeptCoordinatorEmail: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

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
