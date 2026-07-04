import { IsString, IsNotEmpty, IsUrl, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty({
    example: 'growth',
    description: 'The plan ID to subscribe to',
    enum: ['growth', 'enterprise'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['growth', 'enterprise'], {
    message: 'Plan ID must be either growth or enterprise.',
  })
  planId: string;

  @ApiProperty({
    example: 'http://localhost:3000/billing?success=true',
    description: 'Redirect URL on successful checkout',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl(
    { require_tld: false },
    { message: 'Success URL must be a valid URL.' },
  )
  successUrl: string;

  @ApiProperty({
    example: 'http://localhost:3000/billing?cancelled=true',
    description: 'Redirect URL on cancelled checkout',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false }, { message: 'Cancel URL must be a valid URL.' })
  cancelUrl: string;
}
