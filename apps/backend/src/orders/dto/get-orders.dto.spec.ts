import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GetOrdersDto } from './get-orders.dto';

describe('GetOrdersDto status filter', () => {
  const statusErrors = async (status: string) => {
    const dto = plainToInstance(GetOrdersDto, { status });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'status');
  };

  it.each([
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'completed',
    'cancelled',
    'refunded',
  ])('accepts %s', async (status) => {
    // Must mirror the orders_status_check constraint: a status the database can store
    // but the filter rejects is a set of orders nothing can list. 'confirmed' is the one
    // that bit — paying a pending order moves it there.
    expect(await statusErrors(status)).toHaveLength(0);
  });

  it('still rejects a status the database could never hold', async () => {
    expect(await statusErrors('in_the_post')).toHaveLength(1);
  });
});
