import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { QuoteLineType } from '../enums';
import { Quote } from './Quote';
import { BectuRate } from './BectuRate';

@Entity('quote_lines')
export class QuoteLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => Quote, (quote) => quote.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote: Quote;

  @Column({ name: 'line_type', type: 'text' })
  lineType: QuoteLineType;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'bectu_rate_id', type: 'uuid', nullable: true })
  bectuRateId: string | null;

  @ManyToOne(() => BectuRate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'bectu_rate_id' })
  bectuRate: BectuRate | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 1 })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  unit: string | null;

  @Column({ name: 'unit_rate', type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitRate: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  lineTotal: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
