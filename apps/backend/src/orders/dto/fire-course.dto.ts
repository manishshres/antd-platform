import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Send one course of a coursed order to the kitchen. */
export class FireCourseDto {
  @ApiProperty({
    example: 2,
    description: 'Course to fire: 1 Appetizers, 2 Mains, 3 Dessert',
  })
  @IsInt()
  @IsIn([1, 2, 3])
  course: number;

  @ApiProperty({
    required: false,
    description:
      'Idempotency key minted on-device. Replaying it is a no-op, so a ' +
      'double-tapped Fire button cannot double-print the ticket.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientMutationId?: string;
}
