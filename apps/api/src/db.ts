import mongoose from 'mongoose';

export async function connectDb(url: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
