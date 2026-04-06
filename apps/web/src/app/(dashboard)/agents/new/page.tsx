import { redirect } from "next/navigation";

export default function NewAgentPage(): never {
  redirect("/agents?create=true");
}
