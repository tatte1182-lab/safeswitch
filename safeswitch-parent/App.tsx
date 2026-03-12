import AddChildEnrollmentFlow from "./components/enrollment/AddChildEnrollmentFlow";

export default function App() {
  return (
    <AddChildEnrollmentFlow
      authToken="mock-token"
      familyId="mock-family-id"
      onComplete={(childId) => console.log("Done:", childId)}
      onDismiss={() => console.log("Dismissed")}
    />
  );
}