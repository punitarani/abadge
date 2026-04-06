import { redirect } from "next/navigation";

export default function CreateItemPage(): never {
  redirect("/items?create=true");
}
