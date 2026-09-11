import { Schema } from "effect";

export const CourseId = Schema.String.pipe(Schema.brand("CourseId"));
export type CourseId = typeof CourseId.Type;

export const Course = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  facultyId: Schema.String,
  minAttendancePct: Schema.Number,
});
export type Course = typeof Course.Type;
