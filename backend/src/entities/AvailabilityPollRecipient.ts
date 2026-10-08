import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { AvailabilityResponse, CrewAvailabilityStatus } from '../enums';
import { CrewMember } from './CrewMember';

@Entity('availability_poll_recipients')
export class AvailabilityPollRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'poll_id' })
  pollId: string;

  @Column({ type: 'uuid', name: 'crew_member_id' })
  crewMemberId: string;

  @Column({ type: 'timestamptz', name: 'invited_at', default: () => 'NOW()' })
  invitedAt: Date;

  @Column({ type: 'text', name: 'response', nullable: true })
  response: AvailabilityResponse | null;

  @Column({ type: 'text', name: 'response_notes', nullable: true })
  responseNotes: string | null;

  @Column({ type: 'timestamptz', name: 'responded_at', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', name: 'applied_status', nullable: true })
  appliedStatus: CrewAvailabilityStatus | null;

  @Column({ type: 'timestamptz', name: 'applied_at', nullable: true })
  appliedAt: Date | null;

  @Column({ type: 'uuid', name: 'applied_by', nullable: true })
  appliedBy: string | null;

  @ManyToOne(() => CrewMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'crew_member_id' })
  crewMember?: CrewMember;
}
