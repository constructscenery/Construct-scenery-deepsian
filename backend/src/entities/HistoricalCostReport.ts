import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { HistoricalCostReportSource, HistoricalCostReportType } from '../enums';

@Entity('historical_cost_reports')
export class HistoricalCostReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'production_id', type: 'uuid', nullable: true })
  productionId: string | null;

  // Intentional snapshot: retain the production name as it was when the report was stored.
  @Column({ name: 'production_name', type: 'text' })
  productionName: string;

  @Column({ name: 'report_type', type: 'text' })
  reportType: HistoricalCostReportType;

  @Column({ type: 'text' })
  source: HistoricalCostReportSource;

  @Column({ name: 'is_legacy', type: 'boolean', default: false })
  isLegacy: boolean;

  @Column({ name: 'report_date', type: 'date', default: () => 'CURRENT_DATE' })
  reportDate: string;

  @Column({ name: 'file_url', type: 'text', nullable: true })
  fileUrl: string | null;

  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey: string | null;

  @Column({ name: 'file_name', type: 'text', nullable: true })
  fileName: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: string | null;

  @Column({ name: 'file_mime_type', type: 'text', nullable: true })
  fileMimeType: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}