export interface RoutingCase {
  name: string;
  input: {
    fullName: string;
    workEmail: string;
    companyName: string;
    companySize: "1-50" | "51-200" | "201-500" | "501-1000" | "1001+";
    requestedSeats: number;
    requestType: "sales" | "support" | "partnership";
    message?: string;
  };
  expected: {
    outcome: "assigned" | "unassigned";
    route: string;
    repId?: string;
  };
}

export const routingCases: RoutingCase[] = [
  {
    name: "existing CRM ownership wins over territory",
    input: {
      fullName: "Alex Buyer",
      workEmail: "alex@acme.example",
      companyName: "Acme Corporation",
      companySize: "51-200",
      requestedSeats: 40,
      requestType: "sales",
    },
    expected: {
      outcome: "assigned",
      route: "existing-crm-owner",
      repId: "rep_marcus",
    },
  },
  {
    name: "unowned US enterprise account uses territory",
    input: {
      fullName: "Taylor Buyer",
      workEmail: "taylor@unowned.example",
      companyName: "Unowned Systems",
      companySize: "501-1000",
      requestedSeats: 250,
      requestType: "sales",
    },
    expected: {
      outcome: "assigned",
      route: "us-enterprise",
      repId: "rep_amelia",
    },
  },
  {
    name: "new US enterprise account uses territory",
    input: {
      fullName: "Jordan Buyer",
      workEmail: "jordan@enterprise-us.example",
      companyName: "Enterprise US",
      companySize: "1001+",
      requestedSeats: 500,
      requestType: "sales",
    },
    expected: {
      outcome: "assigned",
      route: "us-enterprise",
      repId: "rep_amelia",
    },
  },
  {
    name: "new EMEA commercial account uses territory",
    input: {
      fullName: "Morgan Buyer",
      workEmail: "morgan@commercial-emea.example",
      companyName: "Commercial EMEA",
      companySize: "51-200",
      requestedSeats: 30,
      requestType: "sales",
    },
    expected: {
      outcome: "assigned",
      route: "emea-commercial",
      repId: "rep_luca",
    },
  },
  {
    name: "support request never enters sales routing",
    input: {
      fullName: "Sam Customer",
      workEmail: "sam@globex.example",
      companyName: "Globex GmbH",
      companySize: "501-1000",
      requestedSeats: 1,
      requestType: "support",
      message: "I cannot sign in",
    },
    expected: {
      outcome: "unassigned",
      route: "non-sales-request",
    },
  },
  {
    name: "missing enrichment remains unresolved",
    input: {
      fullName: "Casey Buyer",
      workEmail: "casey@unknown.example",
      companyName: "Unknown Company",
      companySize: "1-50",
      requestedSeats: 10,
      requestType: "sales",
    },
    expected: {
      outcome: "unassigned",
      route: "unresolved-company",
    },
  },
];
