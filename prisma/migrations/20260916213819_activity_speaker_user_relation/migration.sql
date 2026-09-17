-- AddForeignKey
ALTER TABLE "activity_speakers" ADD CONSTRAINT "activity_speakers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
